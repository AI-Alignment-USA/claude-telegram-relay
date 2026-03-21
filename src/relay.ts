/**
 * Claude Code Telegram Relay
 *
 * Minimal relay that connects Telegram to Claude Code CLI.
 * Customize this for your own needs.
 *
 * Run: bun run src/relay.ts
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { join, dirname } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { transcribe } from "./transcribe.ts";
import {
  processMemoryIntents,
  getMemoryContext,
  getRelevantContext,
} from "./memory.ts";
import {
  isAgentCommand,
  isWorkflowCommand,
  isWellnessTrigger,
  isShoppingTrigger,
  routeMessage,
  getHelpText,
} from "./agents/router.ts";
import { getAgent } from "./agents/registry.ts";
import { executeAgent } from "./agents/executor.ts";
import { formatCostReport } from "./utils/cost.ts";
import { stripEmDashes, sendTelegramPhoto } from "./utils/telegram.ts";
import {
  submitForApproval,
  determineAutonomyTier,
} from "./workflows/approval.ts";
import { runAdHocMeeting } from "./meetings/adhoc.ts";
import { callCEO, isConfigured as isVoiceConfigured, isConversationalAIReady, getActiveCallCount } from "./utils/voice.ts";
import { postTweet, lastPostError } from "./utils/twitter.ts";
import {
  startVideoRender,
  startVideoPoller,
  stopVideoPoller,
} from "./workflows/video-pipeline.ts";
import {
  isTweetFlowTrigger,
  isPostSelectionReply,
  hasPendingDrafts,
  handleTweetFlow,
} from "./commands/tweet-flow.ts";
import {
  loadStaples,
  addStaple,
  removeStaple,
  formatStaplesList,
  loadPreferences,
  savePreferences,
  spawnShoppingSession,
  spawnCheckoutSession,
  spawnPlaceOrderSession,
  spawnHistorySession,
  detectLoginIssues,
  type ShopSession,
} from "./utils/shop.ts";

const PROJECT_ROOT = dirname(dirname(import.meta.path));

// ============================================================
// CONFIGURATION
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const PROJECT_DIR = process.env.PROJECT_DIR || "";
const RELAY_DIR = process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");

// Directories
const TEMP_DIR = join(RELAY_DIR, "temp");
const UPLOADS_DIR = join(RELAY_DIR, "uploads");

// Session tracking for conversation continuity
const SESSION_FILE = join(RELAY_DIR, "session.json");

interface SessionState {
  sessionId: string | null;
  lastActivity: string;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

async function loadSession(): Promise<SessionState> {
  try {
    const content = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { sessionId: null, lastActivity: new Date().toISOString() };
  }
}

async function saveSession(state: SessionState): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
}

let session = await loadSession();

// ============================================================
// LOCK FILE (prevent multiple instances)
// ============================================================

const LOCK_FILE = join(RELAY_DIR, "bot.lock");

async function acquireLock(): Promise<boolean> {
  try {
    const existingLock = await readFile(LOCK_FILE, "utf-8").catch(() => null);

    if (existingLock) {
      const pid = parseInt(existingLock);
      try {
        process.kill(pid, 0); // Check if process exists
        console.log(`Another instance running (PID: ${pid})`);
        return false;
      } catch {
        console.log("Stale lock found, taking over...");
      }
    }

    await writeFile(LOCK_FILE, process.pid.toString());
    return true;
  } catch (error) {
    console.error("Lock error:", error);
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_FILE).catch(() => {});
}

// Cleanup on exit
process.on("exit", () => {
  try {
    require("fs").unlinkSync(LOCK_FILE);
  } catch {}
});
process.on("SIGINT", async () => {
  stopVideoPoller();
  await releaseLock();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  stopVideoPoller();
  await releaseLock();
  process.exit(0);
});

// ============================================================
// SETUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  console.log("\nTo set up:");
  console.log("1. Message @BotFather on Telegram");
  console.log("2. Create a new bot with /newbot");
  console.log("3. Copy the token to .env");
  process.exit(1);
}

if (!ALLOWED_USER_ID) {
  console.error("TELEGRAM_USER_ID not set! Refusing to start without access control.");
  console.log("\nTo set up:");
  console.log("1. Message @userinfobot on Telegram to get your user ID");
  console.log("2. Add TELEGRAM_USER_ID=your_id to .env");
  process.exit(1);
}

// Create directories
await mkdir(TEMP_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });

// ============================================================
// SUPABASE (optional — only if configured)
// ============================================================

const supabase: SupabaseClient | null =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

async function saveMessage(
  role: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("messages").insert({
      role,
      content,
      channel: "telegram",
      metadata: metadata || {},
    });
  } catch (error) {
    console.error("Supabase save error:", error);
  }
}

// Acquire lock
if (!(await acquireLock())) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ============================================================
// SECURITY: Only respond to authorized user
// ============================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();

  // If ALLOWED_USER_ID is set, enforce it
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Unauthorized: ${userId}`);
    await ctx.reply("This bot is private.");
    return;
  }

  await next();
});

// ============================================================
// CORE: Call Claude CLI
// ============================================================

async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string }
): Promise<string> {
  const args = [CLAUDE_PATH, "-p", prompt];

  // Resume previous session if available and requested
  if (options?.resume && session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push("--output-format", "text");

  console.log(`Calling Claude: ${prompt.substring(0, 50)}...`);

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_DIR || undefined,
      env: {
        ...process.env,
        // Pass through any env vars Claude might need
      },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude error:", stderr);
      return `Error: ${stderr || "Claude exited with code " + exitCode}`;
    }

    // Extract session ID from output if present (for --resume)
    const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
    if (sessionMatch) {
      session.sessionId = sessionMatch[1];
      session.lastActivity = new Date().toISOString();
      await saveSession(session);
    }

    return output.trim();
  } catch (error) {
    console.error("Spawn error:", error);
    return `Error: Could not run Claude CLI`;
  }
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

// Callback queries (inline button responses for approvals)
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, taskId] = data.split(":");

  if (!taskId || !supabase) {
    await ctx.answerCallbackQuery({ text: "Error: missing data" });
    return;
  }

  // Handle shopping approval callbacks
  if (action === "shop_approve_cart" || action === "shop_approve_checkout" ||
      action === "shop_handle_manually" || action === "shop_change_cart") {
    await handleShopCallback(ctx, action, taskId);
    return;
  }

  // Handle meeting approval/rejection
  if (action === "meeting_approve" || action === "meeting_reject") {
    const status = action === "meeting_approve" ? "completed" : "cancelled";
    const label = action === "meeting_approve" ? "Recommendation approved." : "Recommendation rejected.";

    await supabase
      .from("meetings")
      .update({ status, completed_at: new Date().toISOString() })
      .eq("id", taskId);

    await ctx.answerCallbackQuery({ text: label });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply(label);
    return;
  }

  if (action === "approve" || action === "reject") {
    const status = action === "approve" ? "approved" : "rejected";

    await supabase
      .from("tasks")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", taskId);

    await supabase
      .from("approvals")
      .update({ status, resolved_at: new Date().toISOString() })
      .eq("task_id", taskId);

    // If this is a CISO quarantine patch approval, un-quarantine the agent
    if (action === "approve") {
      const { data: task } = await supabase
        .from("tasks")
        .select("metadata, output, agent_id")
        .eq("id", taskId)
        .single();

      if (task?.metadata?.patch_type === "ciso_quarantine" && task?.metadata?.quarantine_target) {
        const targetId = task.metadata.quarantine_target;
        await supabase
          .from("agents")
          .update({
            active: true,
            quarantined: false,
            quarantine_reason: null,
          })
          .eq("id", targetId);

        await ctx.reply(`Agent ${targetId} has been un-quarantined and reactivated.`);
      }

      // Execute voice call on approval
      if (task?.metadata?.task_type === "voice_call" && task?.metadata?.call_message) {
        const agentName = task.metadata.call_agent || "System";
        const callResult = await callCEO(agentName, task.metadata.call_message);
        if (callResult) {
          await ctx.reply(
            `Call placed to ${callResult.to} (SID: ${callResult.callSid})\nMode: ${callResult.mode} | Provider: ${callResult.provider}`
          );
        } else {
          await ctx.reply("Failed to place call. Check voice configuration.");
        }
      }

      // Post tweet on CMO approval — only for CMO tweet tasks
      if (task?.metadata?.task_type === "tweet" && task?.agent_id === "cmo" && task?.output) {
        const tweetText = extractTweetText(task.output);
        if (tweetText.length > 280) {
          await ctx.reply(
            `Tweet is ${tweetText.length} characters (limit 280). Please ask CMO to shorten it.\n\n` +
            `Draft:\n${tweetText}`
          );
        } else if (tweetText.length === 0) {
          await ctx.reply("Could not extract tweet text from CMO draft. Review manually with /approved");
        } else {
          try {
            const tweetResult = await postTweet(tweetText);
            if (tweetResult) {
              const tweetUrl = `https://x.com/i/status/${tweetResult.id}`;
              await ctx.reply(`Posted to X\n${tweetUrl}`);
            } else if (lastPostError === 503) {
              // Save approved tweet and notify — X API is down (known issue since Feb 2026)
              await supabase
                .from("tasks")
                .update({
                  status: "pending_post",
                  metadata: { ...task.metadata, approved_tweet_text: tweetText, failed_at: new Date().toISOString() },
                  updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);
              await ctx.reply(
                `X API is down (503 after 3 retries). Approved tweet saved.\n\n` +
                `Tweet text:\n${tweetText}\n\n` +
                `Post manually or trigger Chrome automation when the API recovers.`
              );
            } else {
              await ctx.reply(`Tweet failed to post (error ${lastPostError}). Check X/Twitter configuration.`);
            }
          } catch (err: any) {
            await ctx.reply(`Tweet error: ${err.message || err}`);
          }
        }
      }

      // Start video render on video_post approval
      if (task?.metadata?.task_type === "video_post" && task?.output) {
        await startVideoRender({
          bot,
          supabase,
          taskId,
          taskOutput: task.output,
          taskMetadata: task.metadata || {},
        });
      }
    }

    await ctx.answerCallbackQuery({
      text: action === "approve" ? "Approved!" : "Rejected.",
    });

    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply(`Task ${status}.`);
  } else if (action === "changes") {
    await supabase
      .from("tasks")
      .update({
        status: "changes_requested",
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    await ctx.answerCallbackQuery({ text: "Send your feedback next." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("What changes would you like? (Reply with your feedback)");
  }
});

// Text messages
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  console.log(`Message: ${text.substring(0, 50)}...`);

  await ctx.replyWithChatAction("typing");

  // Handle /team or /agents help
  if (text === "/team" || text === "/agents") {
    await sendResponse(ctx, getHelpText());
    return;
  }

  // Check if this is a reply to a CMO tweet approval message — edit-and-post flow
  if (supabase && ctx.message.reply_to_message) {
    const repliedMsgId = ctx.message.reply_to_message.message_id;

    // Look up whether the replied-to message is a pending tweet approval
    const { data: approvalRow } = await supabase
      .from("approvals")
      .select("task_id, status")
      .eq("telegram_message_id", repliedMsgId)
      .eq("status", "pending")
      .single();

    if (approvalRow) {
      const { data: task } = await supabase
        .from("tasks")
        .select("id, metadata, agent_id, status")
        .eq("id", approvalRow.task_id)
        .single();

      if (task?.metadata?.task_type === "tweet" && task?.agent_id === "cmo") {
        const tweetText = extractTweetText(text);

        if (tweetText.length === 0) {
          await ctx.reply("Could not extract tweet text from your reply.");
          return;
        }

        if (tweetText.length > 280) {
          await ctx.reply(
            `Your edit is ${tweetText.length} characters (limit 280). Shorten and reply again.`
          );
          return;
        }

        try {
          const tweetResult = await postTweet(tweetText);
          if (tweetResult) {
            const tweetUrl = `https://x.com/i/status/${tweetResult.id}`;

            // Mark task and approval as completed
            await supabase
              .from("tasks")
              .update({
                status: "approved",
                output: tweetText,
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.id);
            await supabase
              .from("approvals")
              .update({ status: "approved", resolved_at: new Date().toISOString() })
              .eq("task_id", task.id);

            await ctx.reply(`Posted to X (your edit)\n${tweetUrl}`);
          } else if (lastPostError === 503) {
            // Save edited tweet and notify — X API is down
            await supabase
              .from("tasks")
              .update({
                status: "pending_post",
                output: tweetText,
                metadata: { ...task.metadata, approved_tweet_text: tweetText, failed_at: new Date().toISOString() },
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.id);
            await supabase
              .from("approvals")
              .update({ status: "approved", resolved_at: new Date().toISOString() })
              .eq("task_id", task.id);
            await ctx.reply(
              `X API is down (503 after 3 retries). Your edited tweet saved.\n\n` +
              `Tweet text:\n${tweetText}\n\n` +
              `Post manually or trigger Chrome automation when the API recovers.`
            );
          } else {
            await ctx.reply(`Tweet failed to post (error ${lastPostError}). Check X/Twitter configuration.`);
          }
        } catch (err: any) {
          await ctx.reply(`Tweet error: ${err.message || err}`);
        }
        return;
      }
    }
  }

  // Check if this is a follow-up for an active shopping session
  if (supabase) {
    const { data: activeShopTasks } = await supabase
      .from("tasks")
      .select("id, metadata")
      .eq("agent_id", "head-procurement")
      .in("status", ["in_progress"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (activeShopTasks && activeShopTasks.length > 0) {
      const shopTask = activeShopTasks[0];
      const shopState = shopTask.metadata?.shop_state;

      if (shopState === "awaiting_list") {
        // User is providing their grocery/takeout list
        await handleShopListResponse(ctx, shopTask.id, shopTask.metadata, text);
        return;
      }
    }
  }

  // Check if this is feedback for a "changes requested" task
  if (supabase) {
    const { data: pendingChanges } = await supabase
      .from("tasks")
      .select("id, agent_id, input, output")
      .eq("status", "changes_requested")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (pendingChanges && pendingChanges.length > 0) {
      const task = pendingChanges[0];
      await ctx.replyWithChatAction("typing");

      // Save user feedback
      await supabase
        .from("tasks")
        .update({
          user_feedback: text,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      // Re-run the agent with feedback
      const agent = await getAgent(task.agent_id);
      if (agent) {
        const revisedPrompt =
          `Revise your previous draft based on this feedback.\n\n` +
          `Original request: ${task.input}\n\n` +
          `Your previous draft:\n${task.output}\n\n` +
          `Feedback from Crevita: ${text}\n\n` +
          `Please produce a revised version addressing the feedback.`;

        const result = await executeAgent(agent, revisedPrompt, {
          supabase,
          taskId: task.id,
        });

        // Re-submit for approval
        await submitForApproval({
          bot,
          supabase,
          agent,
          taskId: task.id,
          title: (task.input || "Revised draft").substring(0, 100),
          output: result.response,
          autonomyTier: 2,
        });
      }
      return;
    }
  }

  // Handle dashboard commands (/product, /content, /issue)
  if (isDashboardCommand(text)) {
    await handleDashboardCommand(ctx, text);
    return;
  }

  // Handle workflow commands (/status, /costs, /approve)
  if (isWorkflowCommand(text)) {
    await handleWorkflowCommand(ctx, text);
    return;
  }

  // Handle tweet flow ("draft tweets" / "tweet drafts" / "post 1 and 3")
  if (isTweetFlowTrigger(text) || (hasPendingDrafts() && isPostSelectionReply(text))) {
    await handleTweetFlow(
      async (msg: string) => { await sendResponse(ctx, msg); },
      text
    );
    return;
  }

  // Handle /shop commands (custom handler with subcommands and approval gates)
  if (text.toLowerCase().startsWith("/shop")) {
    await handleShopCommand(ctx, text);
    return;
  }

  // Handle agent commands (/coo, /cfo, /cmo, etc.)
  if (isAgentCommand(text)) {
    await handleAgentCommand(ctx, text);
    return;
  }

  // Natural wellness triggers (route to Head of Wellness without explicit command)
  if (isWellnessTrigger(text)) {
    await handleAgentCommand(ctx, `/wellness ${text}`);
    return;
  }

  // Natural shopping triggers (route to Head of Procurement without explicit command)
  if (isShoppingTrigger(text)) {
    await handleShopCommand(ctx, `/shop ${text}`);
    return;
  }

  // Default: existing general assistant behavior
  await saveMessage("user", text);

  // Gather context: semantic search + facts/goals
  const [relevantContext, memoryContext] = await Promise.all([
    getRelevantContext(supabase, text),
    getMemoryContext(supabase),
  ]);

  const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext);
  const rawResponse = await callClaude(enrichedPrompt, { resume: true });

  // Parse and save any memory intents, strip tags from response
  const response = await processMemoryIntents(supabase, rawResponse);

  await saveMessage("assistant", response);
  await sendResponse(ctx, response);
});

// ============================================================
// AGENT COMMAND HANDLER
// ============================================================

// Track recent agent context for follow-up conversations
const agentContextHistory = new Map<string, { messages: string[]; lastActivity: number }>();

function getAgentContext(agentId: string): string {
  const ctx = agentContextHistory.get(agentId);
  if (!ctx) return "";
  // Expire context after 30 minutes of inactivity
  if (Date.now() - ctx.lastActivity > 30 * 60 * 1000) {
    agentContextHistory.delete(agentId);
    return "";
  }
  if (ctx.messages.length === 0) return "";
  return "Recent conversation context with this agent:\n" + ctx.messages.join("\n") + "\n";
}

function addToAgentContext(agentId: string, role: string, content: string): void {
  let ctx = agentContextHistory.get(agentId);
  if (!ctx) {
    ctx = { messages: [], lastActivity: Date.now() };
    agentContextHistory.set(agentId, ctx);
  }
  ctx.messages.push(`${role}: ${content.substring(0, 500)}`);
  ctx.lastActivity = Date.now();
  // Keep last 6 exchanges
  if (ctx.messages.length > 12) {
    ctx.messages = ctx.messages.slice(-12);
  }
}

/**
 * Detect if a CMO tweet request lacks a specific topic.
 * Returns true for generic requests like "draft a tweet" or "draft a tweet about today's AI news".
 * Returns false when a concrete topic is provided like "draft a tweet about X scoring 75% on OSWorld".
 */
function isCmoTweetWithoutTopic(message: string): boolean {
  const lower = message.toLowerCase();
  const isTweetRequest =
    lower.includes("tweet") || lower.includes("draft") || lower.includes("post");
  if (!isTweetRequest) return false;

  // Strip the action words to isolate the topic portion
  const topicPortion = lower
    .replace(/\b(draft|write|create|compose|make)\b/g, "")
    .replace(/\b(a|an|the|me|for|about|on|some|new)\b/g, "")
    .replace(/\b(tweet|post|thread)\b/g, "")
    .replace(/\b(today'?s?|latest|recent|current)\b/g, "")
    .replace(/\b(ai|news|development|update|story|stories)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  // If after stripping generic words there's very little left, no specific topic was given
  return topicPortion.length < 5;
}

// ============================================================
// SHOPPING COMMAND HANDLER
// ============================================================

async function handleShopCommand(ctx: Context, text: string): Promise<void> {
  const parts = text.split(/\s+/);
  const subcommand = parts[1]?.toLowerCase() || "";
  const rest = parts.slice(2).join(" ").trim();

  // /shop (no subcommand) -- show usage
  if (!subcommand) {
    await sendResponse(ctx,
      `*Head of Procurement*\n\n` +
      `  /shop groceries - Start a grocery order\n` +
      `  /shop takeout - Order takeout\n` +
      `  /shop reorder - Reorder a previous order\n` +
      `  /shop staples - View your staples list\n` +
      `  /shop staples add [item] - Add to staples\n` +
      `  /shop staples remove [item] - Remove from staples\n` +
      `  /shop history - Learn from your Uber Eats history\n` +
      `  /shop status - Check current shopping task\n` +
      `  /shop gift - Coming soon!`
    );
    return;
  }

  // /shop gift -- Phase 2
  if (subcommand === "gift") {
    await ctx.reply("Coming soon! Gift shopping will be available in Phase 2.");
    return;
  }

  // /shop staples -- manage staples list
  if (subcommand === "staples") {
    const staplesAction = parts[2]?.toLowerCase() || "";
    if (staplesAction === "add" && rest.length > 4) {
      // "add" is 3 chars + space, so item starts after "add "
      const item = parts.slice(3).join(" ").trim();
      if (!item) {
        await ctx.reply("Usage: /shop staples add [item]\nExample: /shop staples add milk");
        return;
      }
      const result = await addStaple(item);
      await ctx.reply(stripEmDashes(result));
    } else if (staplesAction === "remove" && rest.length > 7) {
      const item = parts.slice(3).join(" ").trim();
      if (!item) {
        await ctx.reply("Usage: /shop staples remove [item]\nExample: /shop staples remove milk");
        return;
      }
      const result = await removeStaple(item);
      await ctx.reply(stripEmDashes(result));
    } else {
      const data = await loadStaples();
      await sendResponse(ctx, formatStaplesList(data));
    }
    return;
  }

  // /shop status -- check active shopping tasks
  if (subcommand === "status") {
    if (!supabase) {
      await ctx.reply("Supabase not configured.");
      return;
    }
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, status, title, metadata, created_at")
      .eq("agent_id", "head-procurement")
      .in("status", ["in_progress", "awaiting_approval", "awaiting_coo"])
      .order("created_at", { ascending: false })
      .limit(5);

    if (!tasks || tasks.length === 0) {
      await ctx.reply("No active shopping tasks.");
      return;
    }

    const lines = tasks.map(
      (t: any) => `  [${t.metadata?.shop_state || t.status}] ${t.title}`
    );
    await sendResponse(ctx, `*Shopping Tasks*\n\n${lines.join("\n")}`);
    return;
  }

  // /shop history -- learn from Uber Eats order history
  if (subcommand === "history") {
    await ctx.reply("Analyzing your Uber Eats order history... This may take a few minutes.");
    await ctx.replyWithChatAction("typing");

    const agent = await getAgent("head-procurement");
    if (!agent) {
      await ctx.reply("Head of Procurement agent not found.");
      return;
    }

    const result = await spawnHistorySession(agent.systemPrompt);

    if (result.preferences) {
      await savePreferences(result.preferences as any);
      await sendResponse(ctx,
        `*Order History Analysis Complete*\n\n` +
        `${result.response}\n\n` +
        `Preferences have been saved and will be used for future orders.`
      );
    } else {
      await sendResponse(ctx,
        `*Order History Analysis*\n\n${result.response}`
      );
    }
    return;
  }

  // /shop groceries, /shop takeout, /shop reorder -- start a shopping flow
  if (subcommand === "groceries" || subcommand === "takeout" || subcommand === "reorder") {
    if (!supabase) {
      await ctx.reply("Supabase not configured. Shopping requires task tracking.");
      return;
    }

    // If user provided items inline (e.g., /shop groceries milk, eggs, bread)
    if (rest && subcommand !== "reorder") {
      // Items provided inline, skip the "what do you need?" step
      const items = rest.split(/,\s*/).map((i) => i.trim()).filter(Boolean);
      await startShoppingSession(ctx, subcommand as "groceries" | "takeout", items);
      return;
    }

    if (subcommand === "reorder") {
      await startShoppingSession(ctx, "groceries", [], true);
      return;
    }

    // No items provided -- ask what they need
    const mode = subcommand === "groceries" ? "shop_groceries" : "shop_takeout";
    const { data: task } = await supabase
      .from("tasks")
      .insert({
        agent_id: "head-procurement",
        type: "interactive",
        autonomy_tier: 2,
        status: "in_progress",
        title: subcommand === "groceries" ? "Grocery order" : "Takeout order",
        input: text,
        metadata: {
          task_type: mode,
          shop_state: "awaiting_list",
        },
      })
      .select("id")
      .single();

    if (subcommand === "groceries") {
      await ctx.reply(
        `What do you need? You can:\n` +
        `- Send a list (e.g., "milk, eggs, chicken, bread")\n` +
        `- Say "staples" for your usual order\n` +
        `- Say "reorder" to repeat a recent order`
      );
    } else {
      await ctx.reply(
        `What are you in the mood for?\n` +
        `You can say a cuisine, a restaurant name, or just describe what you want.`
      );
    }
    return;
  }

  // If subcommand doesn't match, check if it's a natural language request
  // routed here via shopping triggers (e.g., "order groceries tonight")
  const lowerText = text.toLowerCase();
  if (lowerText.includes("grocer")) {
    await handleShopCommand(ctx, "/shop groceries");
  } else if (lowerText.includes("takeout") || lowerText.includes("dinner") ||
             lowerText.includes("food") || lowerText.includes("sushi") ||
             lowerText.includes("pizza")) {
    await handleShopCommand(ctx, "/shop takeout");
  } else {
    await sendResponse(ctx,
      `I'm not sure what you'd like to shop for. Try:\n` +
      `  /shop groceries\n` +
      `  /shop takeout\n\n` +
      `Send /shop for all options.`
    );
  }
}

/**
 * Handle the user's item list response for an active shopping session
 */
async function handleShopListResponse(
  ctx: Context,
  taskId: string,
  metadata: any,
  text: string
): Promise<void> {
  if (!supabase) return;

  const taskType = metadata?.task_type || "shop_groceries";
  const isGrocery = taskType === "shop_groceries";

  // Check for special keywords
  const lower = text.toLowerCase().trim();
  if (lower === "staples") {
    const staples = await loadStaples();
    if (staples.staples.length === 0) {
      await ctx.reply("Your staples list is empty. Add items with /shop staples add [item], or send a list instead.");
      return;
    }
    await startShoppingSession(ctx, "groceries", staples.staples, false, taskId);
    return;
  }
  if (lower === "reorder") {
    await startShoppingSession(ctx, "groceries", [], true, taskId);
    return;
  }

  // Parse the item list (comma-separated, newline-separated, or just space-separated)
  let items: string[];
  if (text.includes(",")) {
    items = text.split(/,\s*/).map((i) => i.trim()).filter(Boolean);
  } else if (text.includes("\n")) {
    items = text.split("\n").map((i) => i.trim()).filter(Boolean);
  } else {
    // For takeout, the whole text is the request
    items = isGrocery ? [text.trim()] : [text.trim()];
  }

  const mode = isGrocery ? "groceries" : "takeout";
  await startShoppingSession(ctx, mode, items, false, taskId);
}

/**
 * Start the actual shopping session (Chrome MCP browsing)
 */
async function startShoppingSession(
  ctx: Context,
  mode: "groceries" | "takeout",
  items: string[],
  isReorder: boolean = false,
  existingTaskId?: string
): Promise<void> {
  if (!supabase) return;

  const agent = await getAgent("head-procurement");
  if (!agent) {
    await ctx.reply("Head of Procurement agent not found.");
    return;
  }

  // Update or create task
  let taskId = existingTaskId;
  if (taskId) {
    await supabase
      .from("tasks")
      .update({
        metadata: {
          task_type: mode === "groceries" ? "shop_groceries" : "shop_takeout",
          shop_state: "browsing",
          items_requested: items,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
  } else {
    const { data } = await supabase
      .from("tasks")
      .insert({
        agent_id: "head-procurement",
        type: "interactive",
        autonomy_tier: 2,
        status: "in_progress",
        title: mode === "groceries" ? "Grocery order" : "Takeout order",
        input: items.join(", "),
        metadata: {
          task_type: mode === "groceries" ? "shop_groceries" : "shop_takeout",
          shop_state: "browsing",
          items_requested: items,
        },
      })
      .select("id")
      .single();
    taskId = data?.id;
  }

  const itemSummary = items.length > 0 ? items.join(", ") : "previous order";
  await ctx.reply(
    `Shopping for: ${itemSummary}\n\n` +
    `Opening Uber Eats and building your cart... This may take a few minutes.`
  );
  await ctx.replyWithChatAction("typing");

  // Build the shopping session
  const session: ShopSession = {
    mode: isReorder ? "reorder" : mode,
    items: items.length > 0 ? items : undefined,
  };

  const result = await spawnShoppingSession(session, agent.systemPrompt);

  // Check for login/CAPTCHA issues
  if (detectLoginIssues(result.response)) {
    await ctx.reply(
      "Shopping session needs your help - possible login or CAPTCHA issue detected. " +
      "Please check the browser and resolve it, then try again."
    );
    if (taskId) {
      await supabase
        .from("tasks")
        .update({
          status: "in_progress",
          metadata: {
            task_type: mode === "groceries" ? "shop_groceries" : "shop_takeout",
            shop_state: "login_issue",
            items_requested: items,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);
    }
    return;
  }

  // Send screenshots
  for (const screenshot of result.screenshots) {
    await sendTelegramPhoto(screenshot, "Cart screenshot");
  }

  // Send cart summary with approval buttons
  const keyboard = new InlineKeyboard()
    .text("Approve Cart", `shop_approve_cart:${taskId}`)
    .text("Change Items", `shop_change_cart:${taskId}`);

  // Check budget warning
  let budgetWarning = "";
  const staples = await loadStaples();
  const typicalBudget = mode === "groceries"
    ? staples.typical_budget.grocery_run
    : staples.typical_budget.takeout_order;
  if (typicalBudget) {
    // Try to extract a total from the response
    const totalMatch = result.response.match(/\$(\d+\.?\d*)/);
    if (totalMatch) {
      const total = parseFloat(totalMatch[1]);
      if (total > typicalBudget * 1.5) {
        budgetWarning = `\n\nBudget Warning: This order ($${total.toFixed(2)}) is significantly higher than your typical ${mode === "groceries" ? "grocery" : "takeout"} order (~$${typicalBudget.toFixed(2)}).`;
      }
    }
  }

  await sendResponse(ctx,
    `*[Head of Procurement]*\n\n${result.response}${budgetWarning}`
  );

  // Send the approval buttons in a separate message for clarity
  await ctx.reply("Review the cart above. Approve to proceed to checkout, or request changes.", {
    reply_markup: keyboard,
  });

  // Update task state
  if (taskId) {
    await supabase
      .from("tasks")
      .update({
        output: result.response,
        metadata: {
          task_type: mode === "groceries" ? "shop_groceries" : "shop_takeout",
          shop_state: "cart_review",
          items_requested: items,
          screenshots: result.screenshots,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
  }
}

/**
 * Handle shopping-specific callback button presses
 */
async function handleShopCallback(
  ctx: Context,
  action: string,
  taskId: string
): Promise<void> {
  if (!supabase) {
    await ctx.answerCallbackQuery({ text: "Error: Supabase not configured" });
    return;
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, metadata, output")
    .eq("id", taskId)
    .single();

  if (!task) {
    await ctx.answerCallbackQuery({ text: "Task not found" });
    return;
  }

  if (action === "shop_approve_cart") {
    await ctx.answerCallbackQuery({ text: "Cart approved! Proceeding to checkout..." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("Cart approved. Proceeding to checkout... This may take a minute.");
    await ctx.replyWithChatAction("typing");

    // Update state
    await supabase
      .from("tasks")
      .update({
        metadata: { ...task.metadata, shop_state: "checkout_review" },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    // Spawn checkout session
    const agent = await getAgent("head-procurement");
    if (!agent) {
      await ctx.reply("Head of Procurement agent not found.");
      return;
    }

    const result = await spawnCheckoutSession(agent.systemPrompt);

    // Send screenshots
    for (const screenshot of result.screenshots) {
      await sendTelegramPhoto(screenshot, "Checkout screenshot");
    }

    // Send checkout summary with final approval buttons
    const keyboard = new InlineKeyboard()
      .text("Place Order", `shop_approve_checkout:${taskId}`)
      .text("I'll Handle It", `shop_handle_manually:${taskId}`);

    await sendResponse(ctx,
      `*[Head of Procurement] Checkout Review*\n\n${result.response}`
    );
    await ctx.reply("Review the checkout total above. Place the order or handle it manually.", {
      reply_markup: keyboard,
    });

    await supabase
      .from("tasks")
      .update({
        metadata: { ...task.metadata, shop_state: "checkout_review", checkout_summary: result.response },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

  } else if (action === "shop_approve_checkout") {
    await ctx.answerCallbackQuery({ text: "Placing order..." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("Final approval received. Placing the order now...");
    await ctx.replyWithChatAction("typing");

    // Spawn place order session
    const agent = await getAgent("head-procurement");
    if (!agent) {
      await ctx.reply("Head of Procurement agent not found.");
      return;
    }

    const result = await spawnPlaceOrderSession(agent.systemPrompt);

    // Send confirmation screenshots
    for (const screenshot of result.screenshots) {
      await sendTelegramPhoto(screenshot, "Order confirmation");
    }

    await sendResponse(ctx,
      `*[Head of Procurement] Order Placed*\n\n${result.response}`
    );

    // Mark task complete
    await supabase
      .from("tasks")
      .update({
        status: "completed",
        metadata: { ...task.metadata, shop_state: "completed" },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

  } else if (action === "shop_handle_manually") {
    await ctx.answerCallbackQuery({ text: "Got it - finish in the browser." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("No problem. The cart is ready in your browser - finish the checkout there when you're ready.");

    await supabase
      .from("tasks")
      .update({
        status: "completed",
        metadata: { ...task.metadata, shop_state: "manual_handoff" },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

  } else if (action === "shop_change_cart") {
    await ctx.answerCallbackQuery({ text: "Send your changes." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("What changes would you like to make? (e.g., 'swap regular milk for oat milk', 'remove bananas', 'add more chicken')");

    await supabase
      .from("tasks")
      .update({
        status: "changes_requested",
        metadata: { ...task.metadata, shop_state: "awaiting_list" },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
  }
}

async function handleAgentCommand(ctx: Context, text: string): Promise<void> {
  const route = await routeMessage(text);
  if (!route) {
    await ctx.reply("Unknown agent. Send /team for available agents.");
    return;
  }

  const { agent, message } = route;

  // Check if agent is quarantined
  if (supabase) {
    const { data: agentRow } = await supabase
      .from("agents")
      .select("quarantined, quarantine_reason")
      .eq("id", agent.id)
      .single();

    if (agentRow?.quarantined) {
      await ctx.reply(
        `This agent is currently offline for security maintenance.\n\n` +
        `Use /approve to review the pending security patch.`
      );
      return;
    }
  }

  const autonomyTier = determineAutonomyTier(agent, message);

  await saveMessage("user", text, { agent_id: agent.id });
  addToAgentContext(agent.id, "User", message);

  // Create task record
  let taskId: string | undefined;
  if (supabase) {
    // Detect tweet tasks from CMO
    const lowerMsg = message.toLowerCase();
    const isTweet = agent.id === "cmo" && (
      lowerMsg.includes("tweet") ||
      lowerMsg.includes("post") ||
      lowerMsg.includes("draft")
    );

    // Detect video post tasks from CMO or Head of Content
    const isVideoPost =
      (agent.id === "cmo" || agent.id === "head-content") &&
      (lowerMsg.includes("video post") ||
       lowerMsg.includes("video_post") ||
       lowerMsg.includes("video script") ||
       lowerMsg.includes("record a video") ||
       lowerMsg.includes("make a video"));

    const { data } = await supabase
      .from("tasks")
      .insert({
        agent_id: agent.id,
        type: "interactive",
        autonomy_tier: autonomyTier,
        status: "in_progress",
        title: message.substring(0, 100),
        input: message,
        ...(isVideoPost ? { metadata: { task_type: "video_post" } }
          : isTweet ? { metadata: { task_type: "tweet" } }
          : {}),
      })
      .select("id")
      .single();
    taskId = data?.id;
  }

  // Build additional context from prior agent conversations
  const priorContext = getAgentContext(agent.id);

  // If CMO tweet request lacks a specific topic, consult Newsroom first
  let newsroomContext = "";
  if (agent.id === "cmo" && isCmoTweetWithoutTopic(message)) {
    const newsroomAgent = await getAgent("head-newsroom");
    if (newsroomAgent) {
      console.log("[cmo] No specific topic detected, consulting Newsroom...");
      const newsResult = await executeAgent(
        newsroomAgent,
        "What is the top AI development today that hasn't been posted about yet? " +
        "Return the topic, key facts, and source links. Keep it concise.",
        { supabase }
      );
      if (newsResult.response && !newsResult.response.startsWith("Error:")) {
        newsroomContext = `\nNewsroom Research (use this as your tweet topic):\n${newsResult.response}\n`;
      }
    }
  }

  // Execute with the agent's context and model
  const combinedContext = [priorContext, newsroomContext].filter(Boolean).join("\n") || undefined;
  const result = await executeAgent(agent, message, {
    supabase,
    taskId,
    additionalContext: combinedContext,
  });

  // Route through approval pipeline based on tier
  if (supabase && taskId && autonomyTier >= 2) {
    const approval = await submitForApproval({
      bot,
      supabase,
      agent,
      taskId,
      title: message.substring(0, 100),
      output: result.response,
      autonomyTier: autonomyTier as 1 | 2 | 3,
    });

    if (approval.handled) {
      // Approval workflow sent its own Telegram messages
      await saveMessage("assistant", result.response, { agent_id: agent.id });
      addToAgentContext(agent.id, "Agent", result.response);
      return;
    }
  }

  // Tier 1 or no Supabase: respond directly
  if (supabase && taskId) {
    await supabase
      .from("tasks")
      .update({
        status: "completed",
        output: result.response,
        completed_at: new Date().toISOString(),
        metadata: {
          model: result.model,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_cents: result.costCents,
        },
      })
      .eq("id", taskId);
  }

  await saveMessage("assistant", result.response, { agent_id: agent.id });
  addToAgentContext(agent.id, "Agent", result.response);

  const header = `*[${agent.name}]*\n\n`;
  await sendResponse(ctx, header + result.response);
}

// ============================================================
// DASHBOARD COMMANDS (/product, /content, /issue)
// ============================================================

const DASHBOARD_COMMANDS = ["/product", "/content", "/issue"];

function isDashboardCommand(text: string): boolean {
  const cmd = text.split(" ")[0].toLowerCase();
  return DASHBOARD_COMMANDS.includes(cmd);
}

async function handleDashboardCommand(
  ctx: Context,
  text: string
): Promise<void> {
  if (!supabase) {
    await ctx.reply("Supabase not configured.");
    return;
  }

  const parts = text.split(" ");
  const cmd = parts[0].toLowerCase();
  const action = parts[1]?.toLowerCase();

  // /product update [name] [status] [notes]
  if (cmd === "/product") {
    if (action !== "update" || parts.length < 4) {
      await ctx.reply(
        "Usage: /product update [name] [status] [notes]\n\n" +
        "Status: Live, Draft, Planned, Blocked\n" +
        "Example: /product update \"My Course\" Live Great launch!"
      );
      return;
    }

    // Parse: support quoted product names
    const rest = text.substring("/product update ".length).trim();
    let productName: string;
    let remainder: string;

    if (rest.startsWith('"')) {
      const endQuote = rest.indexOf('"', 1);
      if (endQuote === -1) {
        await ctx.reply("Missing closing quote for product name.");
        return;
      }
      productName = rest.substring(1, endQuote);
      remainder = rest.substring(endQuote + 1).trim();
    } else {
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx === -1) {
        await ctx.reply("Usage: /product update [name] [status] [notes]");
        return;
      }
      productName = rest.substring(0, spaceIdx);
      remainder = rest.substring(spaceIdx + 1).trim();
    }

    const statusParts = remainder.split(" ");
    const newStatus = statusParts[0];
    const notes = statusParts.slice(1).join(" ") || null;

    if (!["Live", "Draft", "Planned", "Blocked"].includes(newStatus)) {
      await ctx.reply("Invalid status. Use: Live, Draft, Planned, or Blocked");
      return;
    }

    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .ilike("name", productName)
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from("products")
        .update({ status: newStatus, notes, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      await ctx.reply(`Updated "${productName}" → ${newStatus}${notes ? ` (${notes})` : ""}`);
    } else {
      await ctx.reply(`Product "${productName}" not found. Check spelling or add it via the dashboard.`);
    }
    return;
  }

  // /content add [title] [type] [platform]
  // /content move [id] [new_status]
  if (cmd === "/content") {
    if (action === "add") {
      const rest = text.substring("/content add ".length).trim();
      const contentParts = rest.split(" ");
      if (contentParts.length < 3) {
        await ctx.reply(
          "Usage: /content add [title] [type] [platform]\n\n" +
          "Type: video, post, blog\n" +
          "Example: /content add \"Weekly Recap\" video YouTube"
        );
        return;
      }

      let title: string;
      let afterTitle: string;

      if (rest.startsWith('"')) {
        const endQuote = rest.indexOf('"', 1);
        if (endQuote === -1) {
          await ctx.reply("Missing closing quote for title.");
          return;
        }
        title = rest.substring(1, endQuote);
        afterTitle = rest.substring(endQuote + 1).trim();
      } else {
        // Single-word title
        title = contentParts[0];
        afterTitle = contentParts.slice(1).join(" ");
      }

      const afterParts = afterTitle.split(" ");
      const contentType = afterParts[0]?.toLowerCase();
      const platform = afterParts.slice(1).join(" ") || afterParts[1] || "Unknown";

      if (!["video", "post", "blog"].includes(contentType)) {
        await ctx.reply("Invalid type. Use: video, post, or blog");
        return;
      }

      await supabase.from("content_pipeline").insert({
        title,
        type: contentType,
        platform,
        status: "Idea",
      });
      await ctx.reply(`Added to content pipeline: "${title}" (${contentType} on ${platform})`);
    } else if (action === "move") {
      const contentId = parts[2];
      const newStatus = parts[3];

      if (!contentId || !newStatus) {
        await ctx.reply(
          "Usage: /content move [id] [new_status]\n\n" +
          "Status: Idea, Draft, Approved, Published"
        );
        return;
      }

      if (!["Idea", "Draft", "Approved", "Published"].includes(newStatus)) {
        await ctx.reply("Invalid status. Use: Idea, Draft, Approved, or Published");
        return;
      }

      const { error } = await supabase
        .from("content_pipeline")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", contentId);

      if (error) {
        await ctx.reply(`Error moving content: ${error.message}`);
      } else {
        await ctx.reply(`Content moved to ${newStatus}`);
      }
    } else {
      await ctx.reply(
        "Usage:\n" +
        "  /content add [title] [type] [platform]\n" +
        "  /content move [id] [new_status]"
      );
    }
    return;
  }

  // /issue add [title] [severity] [notes]
  // /issue resolve [id]
  if (cmd === "/issue") {
    if (action === "add") {
      const rest = text.substring("/issue add ".length).trim();
      if (!rest) {
        await ctx.reply(
          "Usage: /issue add [title] [severity] [notes]\n\n" +
          "Severity: Critical, Warning, Info\n" +
          "Example: /issue add \"Twitter API down\" Critical Returning 503 errors"
        );
        return;
      }

      let title: string;
      let afterTitle: string;

      if (rest.startsWith('"')) {
        const endQuote = rest.indexOf('"', 1);
        if (endQuote === -1) {
          await ctx.reply("Missing closing quote for title.");
          return;
        }
        title = rest.substring(1, endQuote);
        afterTitle = rest.substring(endQuote + 1).trim();
      } else {
        const spaceIdx = rest.indexOf(" ");
        if (spaceIdx === -1) {
          title = rest;
          afterTitle = "";
        } else {
          title = rest.substring(0, spaceIdx);
          afterTitle = rest.substring(spaceIdx + 1).trim();
        }
      }

      const afterParts = afterTitle.split(" ");
      let severity = afterParts[0] || "Warning";
      const notes = afterParts.slice(1).join(" ") || null;

      if (!["Critical", "Warning", "Info"].includes(severity)) {
        // Treat as notes if not a valid severity
        severity = "Warning";
      }

      await supabase.from("known_issues").insert({
        title,
        severity,
        notes: afterTitle && !["Critical", "Warning", "Info"].includes(afterParts[0]) ? afterTitle : notes,
      });
      await ctx.reply(`Issue created: "${title}" [${severity}]`);
    } else if (action === "resolve") {
      const issueId = parts[2];
      if (!issueId) {
        await ctx.reply("Usage: /issue resolve [id]");
        return;
      }

      const { error } = await supabase
        .from("known_issues")
        .update({ status: "Fixed", resolved_at: new Date().toISOString() })
        .eq("id", issueId);

      if (error) {
        await ctx.reply(`Error resolving issue: ${error.message}`);
      } else {
        await ctx.reply("Issue marked as Fixed.");
      }
    } else {
      await ctx.reply(
        "Usage:\n" +
        "  /issue add [title] [severity] [notes]\n" +
        "  /issue resolve [id]"
      );
    }
    return;
  }
}

// ============================================================
// WORKFLOW COMMAND HANDLER
// ============================================================

async function handleWorkflowCommand(
  ctx: Context,
  text: string
): Promise<void> {
  const cmd = text.split(" ")[0].toLowerCase();

  if (cmd === "/status") {
    if (!supabase) {
      await ctx.reply("Supabase not configured.");
      return;
    }
    const { data: tasks } = await supabase
      .from("tasks")
      .select("agent_id, status, title, created_at")
      .in("status", ["pending", "in_progress", "awaiting_coo", "awaiting_approval", "rendering"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (!tasks || tasks.length === 0) {
      await ctx.reply("No active tasks.");
      return;
    }

    const lines = tasks.map(
      (t: any) => `  [${t.status}] ${t.agent_id}: ${t.title}`
    );
    await sendResponse(ctx, `*Active Tasks*\n\n${lines.join("\n")}`);
  } else if (cmd === "/costs") {
    if (!supabase) {
      await ctx.reply("Supabase not configured.");
      return;
    }
    const { data } = await supabase.rpc("get_daily_costs");
    const report = formatCostReport(data || []);
    await sendResponse(ctx, `*Today's Costs*\n\n${report}`);
  } else if (cmd === "/approve") {
    if (!supabase) {
      await ctx.reply("Supabase not configured.");
      return;
    }
    const { data } = await supabase.rpc("get_pending_approvals");
    if (!data || data.length === 0) {
      await ctx.reply("No pending approvals.");
      return;
    }
    for (const item of data) {
      const { data: task } = await supabase
        .from("tasks")
        .select("output, coo_review")
        .eq("id", item.task_id)
        .single();

      const keyboard = new InlineKeyboard()
        .text("Approve", `approve:${item.task_id}`)
        .text("Reject", `reject:${item.task_id}`)
        .text("Changes", `changes:${item.task_id}`);

      let msg = `*[${item.agent_name}] ${item.title}*\n\n`;
      if (task?.coo_review) msg += `COO Review: ${task.coo_review}\n\n`;
      if (task?.output) msg += task.output.substring(0, 3000);

      await ctx.reply(msg, { reply_markup: keyboard, parse_mode: "Markdown" });
    }
  } else if (cmd === "/meeting") {
    if (!supabase) {
      await ctx.reply("Supabase not configured.");
      return;
    }
    const topic = text.substring("/meeting".length).trim();
    if (!topic) {
      await ctx.reply("Usage: /meeting [topic or decision needed]\n\nExample: /meeting Should we launch the newsletter this week?");
      return;
    }
    // Run meeting asynchronously (it sends its own messages)
    runAdHocMeeting({ bot, supabase, topic }).catch((err) => {
      console.error("Meeting error:", err);
      ctx.reply("Meeting failed. Check logs for details.");
    });
  } else if (cmd === "/approved") {
    if (!supabase) {
      await ctx.reply("Supabase not configured.");
      return;
    }
    const { data: recentApproved } = await supabase
      .from("tasks")
      .select("agent_id, title, output")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!recentApproved || recentApproved.length === 0) {
      await ctx.reply("No recently approved tasks.");
      return;
    }

    const task = recentApproved[0];
    const output = task.output || "(no output)";
    await sendResponse(ctx, `*[${task.agent_id}] ${task.title}*\n\nApproved output:\n\n${output}`);
  } else if (cmd === "/call") {
    // /call [agent] [message] or /call [message]
    if (!isVoiceConfigured()) {
      await ctx.reply(
        "Voice calling is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, " +
        "TWILIO_PHONE_NUMBER, and CEO_PHONE_NUMBER to .env"
      );
      return;
    }

    const args = text.substring("/call".length).trim();
    if (!args) {
      await ctx.reply(
        "Usage: /call [message]\n\n" +
        "Example: /call Reminder to review the quarterly report\n\n" +
        "The message will be converted to speech and played via phone call. " +
        "Requires CEO approval (Tier 2) before the call is placed."
      );
      return;
    }

    // Parse optional agent prefix: /call ciso Security breach detected
    const parts = args.split(" ");
    let agentName = "System";
    let callMessage = args;
    const agentIds = ["coo", "cfo", "cmo", "cio", "ciso"];
    if (agentIds.includes(parts[0].toLowerCase())) {
      agentName = parts[0].toUpperCase();
      callMessage = parts.slice(1).join(" ");
    }

    if (!callMessage.trim()) {
      await ctx.reply("Please provide a message for the call.");
      return;
    }

    // CISO security alerts are Tier 1 (immediate, no approval)
    if (agentName === "CISO") {
      const result = await callCEO("CISO", callMessage);
      if (result) {
        await ctx.reply(
          `CISO security call placed immediately.\n` +
          `To: ${result.to}\nSID: ${result.callSid}\nMode: ${result.mode} | Provider: ${result.provider}`
        );
      } else {
        await ctx.reply("Failed to place CISO security call. Check voice configuration.");
      }
      return;
    }

    // All other calls go through Tier 2 approval
    if (!supabase) {
      await ctx.reply("Supabase not configured. Cannot create approval workflow for calls.");
      return;
    }

    // Create a task for the call
    const { data: taskData } = await supabase
      .from("tasks")
      .insert({
        agent_id: agentName.toLowerCase() === "system" ? "cio" : agentName.toLowerCase(),
        type: "voice_call",
        autonomy_tier: 2,
        status: "awaiting_approval",
        title: `Phone call: ${callMessage.substring(0, 80)}`,
        input: callMessage,
        output: `Call CEO with message: "${callMessage}"`,
        metadata: {
          task_type: "voice_call",
          call_agent: agentName,
          call_message: callMessage,
        },
      })
      .select("id")
      .single();

    if (!taskData) {
      await ctx.reply("Failed to create call task.");
      return;
    }

    // Send approval request
    const keyboard = new InlineKeyboard()
      .text("Approve Call", `approve:${taskData.id}`)
      .text("Reject", `reject:${taskData.id}`);

    await ctx.reply(
      `*[${agentName}] Voice Call Request*\n\n` +
      `_Will call CEO phone with this message:_\n\n` +
      `"${callMessage}"\n\n` +
      `Approve to place the call.`,
      { reply_markup: keyboard, parse_mode: "Markdown" }
    );
  }
}

// Voice messages
bot.on("message:voice", async (ctx) => {
  const voice = ctx.message.voice;
  console.log(`Voice message: ${voice.duration}s`);
  await ctx.replyWithChatAction("typing");

  if (!process.env.VOICE_PROVIDER) {
    await ctx.reply(
      "Voice transcription is not set up yet. " +
        "Run the setup again and choose a voice provider (Groq or local Whisper)."
    );
    return;
  }

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    const transcription = await transcribe(buffer);
    if (!transcription) {
      await ctx.reply("Could not transcribe voice message.");
      return;
    }

    await saveMessage("user", `[Voice ${voice.duration}s]: ${transcription}`);

    const [relevantContext, memoryContext] = await Promise.all([
      getRelevantContext(supabase, transcription),
      getMemoryContext(supabase),
    ]);

    const enrichedPrompt = buildPrompt(
      `[Voice message transcribed]: ${transcription}`,
      relevantContext,
      memoryContext
    );
    const rawResponse = await callClaude(enrichedPrompt, { resume: true });
    const claudeResponse = await processMemoryIntents(supabase, rawResponse);

    await saveMessage("assistant", claudeResponse);
    await sendResponse(ctx, claudeResponse);
  } catch (error) {
    console.error("Voice error:", error);
    await ctx.reply("Could not process voice message. Check logs for details.");
  }
});

// Photos/Images
bot.on("message:photo", async (ctx) => {
  console.log("Image received");
  await ctx.replyWithChatAction("typing");

  try {
    // Get highest resolution photo
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    // Download the image
    const timestamp = Date.now();
    const filePath = join(UPLOADS_DIR, `image_${timestamp}.jpg`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // Claude Code can see images via file path
    const caption = ctx.message.caption || "Analyze this image.";
    const prompt = `[Image: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Image]: ${caption}`);

    const claudeResponse = await callClaude(prompt, { resume: true });

    // Cleanup after processing
    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse);
    await sendResponse(ctx, cleanResponse);
  } catch (error) {
    console.error("Image error:", error);
    await ctx.reply("Could not process image.");
  }
});

// Documents
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  console.log(`Document: ${doc.file_name}`);
  await ctx.replyWithChatAction("typing");

  try {
    const file = await ctx.getFile();
    const timestamp = Date.now();
    const rawName = doc.file_name || `file_${timestamp}`;
    const fileName = rawName.replace(/[\/\\:*?"<>|\.\.]/g, "_");
    const filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);
    if (!filePath.startsWith(UPLOADS_DIR)) {
      console.error(`Path traversal blocked: ${rawName}`);
      await ctx.reply("Invalid filename.");
      return;
    }

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    const caption = ctx.message.caption || `Analyze: ${doc.file_name}`;
    const prompt = `[File: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Document: ${doc.file_name}]: ${caption}`);

    const claudeResponse = await callClaude(prompt, { resume: true });

    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse);
    await sendResponse(ctx, cleanResponse);
  } catch (error) {
    console.error("Document error:", error);
    await ctx.reply("Could not process document.");
  }
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Extract the actual tweet copy from a CMO agent's draft output.
 * Strips preamble like "Here's a draft tweet:", quotation marks, and metadata.
 */
function extractTweetText(raw: string): string {
  let text = raw.trim();

  // If the output contains a quoted block, extract it
  // Matches text wrapped in "..." or "..." (smart quotes)
  const quotedMatch = text.match(/[\u201C"]([\s\S]+?)[\u201D"]/);
  if (quotedMatch && quotedMatch[1].length <= 400) {
    return quotedMatch[1].trim();
  }

  // Strip common preamble patterns (case-insensitive, multiline)
  text = text
    .replace(/^(?:here(?:'s| is) (?:a |the )?(?:draft |revised |updated )?(?:tweet|post|x post)[^:\n]*[:\n]\s*)/im, "")
    .replace(/^(?:draft(?:\s+tweet)?[:\s]*)/im, "")
    .replace(/^(?:tweet[:\s]*)/im, "")
    .trim();

  // Strip trailing metadata lines (e.g., "Character count: 142", "---", hashtag suggestions after a separator)
  text = text
    .replace(/\n---[\s\S]*$/m, "")
    .replace(/\n(?:character count|chars?|length)[:\s]*\d+.*$/im, "")
    .replace(/\n\n(?:notes?|suggestions?|alternatives?)[:\s]*[\s\S]*$/im, "")
    .trim();

  // Remove wrapping quotes if the entire result is quoted
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith('\u201C') && text.endsWith('\u201D'))) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

// Load profile once at startup
let profileContext = "";
try {
  profileContext = await readFile(join(PROJECT_ROOT, "config", "profile.md"), "utf-8");
} catch {
  // No profile yet — that's fine
}

const USER_NAME = process.env.USER_NAME || "";
const USER_TIMEZONE = process.env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

function buildPrompt(
  userMessage: string,
  relevantContext?: string,
  memoryContext?: string
): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = [
    "You are a personal AI assistant responding via Telegram. Keep responses concise and conversational.",
  ];

  if (USER_NAME) parts.push(`You are speaking with ${USER_NAME}.`);
  parts.push(`Current time: ${timeStr}`);
  if (profileContext) parts.push(`\nProfile:\n${profileContext}`);
  if (memoryContext) parts.push(`\n${memoryContext}`);
  if (relevantContext) parts.push(`\n${relevantContext}`);

  parts.push(
    "\nMEMORY MANAGEMENT:" +
      "\nWhen the user shares something worth remembering, sets goals, or completes goals, " +
      "include these tags in your response (they are processed automatically and hidden from the user):" +
      "\n[REMEMBER: fact to store]" +
      "\n[GOAL: goal text | DEADLINE: optional date]" +
      "\n[DONE: search text for completed goal]"
  );

  parts.push(`\nUser: ${userMessage}`);

  return parts.join("\n");
}

async function sendResponse(ctx: Context, response: string): Promise<void> {
  // Strip em dashes from all outgoing messages
  response = stripEmDashes(response);

  // Telegram has a 4096 character limit
  const MAX_LENGTH = 4000;

  if (response.length <= MAX_LENGTH) {
    await ctx.reply(response);
    return;
  }

  // Split long responses
  const chunks = [];
  let remaining = response;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a natural boundary
    let splitIndex = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = MAX_LENGTH;

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trim();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Claude Telegram Relay...");
console.log(`Authorized user: ${ALLOWED_USER_ID || "ANY (not recommended)"}`);
console.log(`Project directory: ${PROJECT_DIR || "(relay working directory)"}`);

bot.start({
  onStart: () => {
    console.log("Bot is running!");
    if (supabase) {
      startVideoPoller(bot, supabase);
    }
  },
});
