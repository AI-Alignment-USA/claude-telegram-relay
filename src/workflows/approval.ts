/**
 * Approval Workflow
 *
 * Tier 2 flow:
 *   Sub-agent drafts → COO (Tamille) reviews → User approves on Telegram → Agent executes
 *
 * Tier 1: autonomous, no approval needed
 * Tier 3: alert only, user acts manually
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bot } from "grammy";
import { getAgent, type AgentConfig } from "../agents/registry.ts";
import { executeAgent } from "../agents/executor.ts";
import { stripEmDashes } from "../utils/telegram.ts";

const CHAT_ID = process.env.TELEGRAM_USER_ID || "";

/**
 * Submit work for the approval pipeline.
 * - Tier 1: completes immediately, returns the output
 * - Tier 2: goes through COO review, then sends inline buttons to user
 * - Tier 3: sends an alert to user, returns notice
 */
export async function submitForApproval(opts: {
  bot: Bot;
  supabase: SupabaseClient;
  agent: AgentConfig;
  taskId: string;
  title: string;
  output: string;
  autonomyTier: 1 | 2 | 3;
}): Promise<{ handled: boolean; response?: string }> {
  const { bot, supabase, agent, taskId, title, output, autonomyTier } = opts;

  if (autonomyTier === 1) {
    // Tier 1: autonomous, just complete
    await supabase
      .from("tasks")
      .update({
        status: "completed",
        output,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    return { handled: false, response: output };
  }

  if (autonomyTier === 3) {
    // Tier 3: alert only
    await supabase
      .from("tasks")
      .update({ status: "completed", output })
      .eq("id", taskId);

    await bot.api.sendMessage(
      CHAT_ID,
      `*[${agent.name}] Manual Action Required*\n\n${title}\n\n${output.substring(0, 3500)}`,
      { parse_mode: "Markdown" }
    );
    return { handled: true, response: "Alert sent. This requires your manual action." };
  }

  // Tier 2: COO review then user approval
  await supabase
    .from("tasks")
    .update({ status: "awaiting_coo", output })
    .eq("id", taskId);

  // Check if COO is quarantined; if so, skip COO review entirely
  const { data: cooRow } = await supabase
    .from("agents")
    .select("quarantined")
    .eq("id", "coo")
    .single();

  const cooQuarantined = cooRow?.quarantined === true;

  // COO reviews the draft (unless quarantined)
  const coo = cooQuarantined ? null : await getAgent("coo");
  if (!coo) {
    // Fallback: skip COO, go straight to user
    const skipNote = cooQuarantined ? "[COO quarantined - review skipped]" : null;
    await sendApprovalToUser(bot, supabase, taskId, agent, title, output, skipNote);
    return { handled: true };
  }

  const cooResult = await executeAgent(coo, buildCooReviewPrompt(agent, title, output), {
    supabase,
    taskType: "review",
  });

  // Save COO review and advance to user approval
  await supabase
    .from("tasks")
    .update({
      status: "awaiting_approval",
      coo_review: cooResult.response,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  await sendApprovalToUser(
    bot,
    supabase,
    taskId,
    agent,
    title,
    output,
    cooResult.response
  );

  return { handled: true };
}

/**
 * Send the approval message to the user on Telegram with inline buttons
 */
async function sendApprovalToUser(
  bot: Bot,
  supabase: SupabaseClient,
  taskId: string,
  agent: AgentConfig,
  title: string,
  output: string,
  cooReview: string | null
): Promise<void> {
  // Strip em dashes and internal process language from all output
  const cleanOutput = stripProcessLanguage(stripEmDashes(output));
  const cleanReview = cooReview ? stripEmDashes(cooReview) : null;

  // Build the message
  let msg = `*[${agent.name}] Awaiting Approval*\n`;
  msg += `_${title}_\n\n`;

  if (cleanReview) {
    msg += `*Tamille's Review:*\n${cleanReview}\n\n`;
    msg += `---\n\n`;
  }

  msg += `*Draft:*\n${cleanOutput.substring(0, 2500)}`;

  if (cleanOutput.length > 2500) {
    msg += "\n\n_(truncated, send /approve to see full)_";
  }

  // Send with inline buttons
  const result = await bot.api.sendMessage(CHAT_ID, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `approve:${taskId}` },
          { text: "Reject", callback_data: `reject:${taskId}` },
          { text: "Request Changes", callback_data: `changes:${taskId}` },
        ],
      ],
    },
  });

  // Create approval record
  await supabase.from("approvals").insert({
    task_id: taskId,
    telegram_message_id: result.message_id,
    telegram_chat_id: CHAT_ID,
    status: "pending",
  });

  // Link the telegram message to the task
  await supabase
    .from("tasks")
    .update({ telegram_message_id: result.message_id })
    .eq("id", taskId);
}

function buildCooReviewPrompt(
  agent: AgentConfig,
  title: string,
  output: string
): string {
  return (
    `Review the following draft from ${agent.name} (${agent.role}) before it goes to Crevita for approval.\n\n` +
    `Task: ${title}\n\n` +
    `Draft:\n${output}\n\n` +
    `Review checklist:\n` +
    `1. Is the content accurate and complete?\n` +
    `2. Is the tone appropriate for the context?\n` +
    `3. Are there any em dashes? (not allowed in public content)\n` +
    `4. For co-parent messages: is the tone diplomatic, professional, factual, never emotional?\n` +
    `5. Any concerns or suggested improvements?\n\n` +
    `Provide a brief review (2-3 sentences) and end with your recommendation: "Recommend approval", "Recommend revision", or "Needs discussion".`
  );
}

/**
 * Strip internal process language from agent output before it reaches the user.
 * Phrases like "COO review", "approval chain", "Tier 2" should not appear in
 * user-facing content from CMO, Household, or other sub-agents.
 */
function stripProcessLanguage(text: string): string {
  return text
    .replace(/\bCOO review\b/gi, "review")
    .replace(/\bawaiting COO\b/gi, "under review")
    .replace(/\bapproval chain\b/gi, "approval")
    .replace(/\bTier [123]\b/gi, "")
    .replace(/\bsub-?agent\b/gi, "team member")
    .replace(/\bautonomy tier\b/gi, "")
    .replace(/  +/g, " ")
    .trim();
}

/**
 * Determine the autonomy tier for a given agent command.
 * Can be overridden by explicit task type keywords.
 */
export function determineAutonomyTier(
  agent: AgentConfig,
  message: string
): 1 | 2 | 3 {
  // Wellness is always Tier 3 (private, no COO review)
  if (agent.id === "head-wellness") return 3;

  const lower = message.toLowerCase();

  // Explicit Tier 3 triggers (manual only)
  if (
    lower.includes("ofw") ||
    lower.includes("our family wizard") ||
    lower.includes("pay ") ||
    lower.includes("payment") ||
    lower.includes("transfer money") ||
    lower.includes("create account") ||
    lower.includes("password")
  ) {
    return 3;
  }

  // Explicit Tier 2 triggers (draft and approve)
  if (
    lower.includes("draft") ||
    lower.includes("write a post") ||
    lower.includes("compose") ||
    lower.includes("tweet") ||
    lower.includes("linkedin post") ||
    lower.includes("newsletter") ||
    lower.includes("email campaign") ||
    lower.includes("message to joshua") ||
    lower.includes("message to co-parent") ||
    lower.includes("publish")
  ) {
    return 2;
  }

  // Default to agent's configured autonomy
  return agent.autonomyDefault as 1 | 2 | 3;
}
