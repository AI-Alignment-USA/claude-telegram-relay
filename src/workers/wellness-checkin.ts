/**
 * Wellness Check-in Worker
 *
 * Weekly check-in every Wednesday at 8pm PT.
 * Uses the Head of Wellness agent for a warm, personal check-in.
 *
 * Run: bun run src/workers/wellness-checkin.ts
 */

import { createClient } from "@supabase/supabase-js";
import { sendTelegram, stripEmDashes } from "../utils/telegram.ts";
import { getAgent } from "../agents/registry.ts";
import { executeAgent } from "../agents/executor.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

async function getRecentWellnessContext(): Promise<string> {
  if (!supabase) return "";

  // Get recent wellness conversations (private, only used by wellness agent)
  const { data } = await supabase
    .from("messages")
    .select("content, created_at")
    .eq("channel", "telegram")
    .filter("metadata->>agent_id", "eq", "head-wellness")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) return "This is your first wellness check-in with Crevita.";

  const recent = data
    .reverse()
    .map((m: any) => {
      const date = new Date(m.created_at).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      return `[${date}] ${m.content.substring(0, 200)}`;
    })
    .join("\n");

  return `Recent wellness conversations (private context):\n${recent}`;
}

async function weeklyCheckin(): Promise<void> {
  const agent = await getAgent("head-wellness");
  if (!agent) {
    console.error("Head of Wellness agent not found");
    return;
  }

  const context = await getRecentWellnessContext();

  const prompt =
    `It's Wednesday evening, time for the weekly wellness check-in.\n\n` +
    `${context}\n\n` +
    `Send a warm, personal check-in message to Crevita. Reference anything relevant from ` +
    `recent conversations if there are any. Keep it natural and genuine, like a close friend ` +
    `checking in. Ask how she's really doing this week.`;

  const result = await executeAgent(agent, prompt, {
    supabase,
    taskType: "checkin",
  });

  const cleanResponse = stripEmDashes(result.response);
  await sendTelegram(cleanResponse);

  // Save the check-in message
  if (supabase) {
    await supabase.from("messages").insert({
      role: "assistant",
      content: cleanResponse,
      channel: "telegram",
      metadata: { agent_id: "head-wellness", type: "weekly_checkin" },
    });
  }

  console.log("Wellness check-in sent.");
}

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  await weeklyCheckin();
}

main();
