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
  routeMessage,
  getHelpText,
} from "./agents/router.ts";
import { getAgent } from "./agents/registry.ts";
import { executeAgent } from "./agents/executor.ts";
import { formatCostReport } from "./utils/cost.ts";
import {
  submitForApproval,
  determineAutonomyTier,
} from "./workflows/approval.ts";

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
  await releaseLock();
  process.exit(0);
});
process.on("SIGTERM", async () => {
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

  // Handle workflow commands (/status, /costs, /approve)
  if (isWorkflowCommand(text)) {
    await handleWorkflowCommand(ctx, text);
    return;
  }

  // Handle agent commands (/coo, /cfo, /cmo, etc.)
  if (isAgentCommand(text)) {
    await handleAgentCommand(ctx, text);
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

async function handleAgentCommand(ctx: Context, text: string): Promise<void> {
  const route = await routeMessage(text);
  if (!route) {
    await ctx.reply("Unknown agent. Send /team for available agents.");
    return;
  }

  const { agent, message } = route;
  const autonomyTier = determineAutonomyTier(agent, message);

  await saveMessage("user", text, { agent_id: agent.id });

  // Create task record
  let taskId: string | undefined;
  if (supabase) {
    const { data } = await supabase
      .from("tasks")
      .insert({
        agent_id: agent.id,
        type: "interactive",
        autonomy_tier: autonomyTier,
        status: "in_progress",
        title: message.substring(0, 100),
        input: message,
      })
      .select("id")
      .single();
    taskId = data?.id;
  }

  // Execute with the agent's context and model
  const result = await executeAgent(agent, message, {
    supabase,
    taskId,
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

  const header = `*[${agent.name}]*\n\n`;
  await sendResponse(ctx, header + result.response);
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
      .in("status", ["pending", "in_progress", "awaiting_coo", "awaiting_approval"])
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
  },
});
