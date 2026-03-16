/**
 * Monday Standup Worker
 *
 * Runs every Monday at 9:30 AM PT (right after morning briefing).
 * Every active agent submits a brief update, COO synthesizes.
 * Tier 1 (autonomous) - delivered directly to Telegram.
 *
 * Run: bun run src/workers/monday-standup.ts
 */

import { createClient } from "@supabase/supabase-js";
import { sendTelegram, stripEmDashes } from "../utils/telegram.ts";
import { getAgent, getAgentIds, selectModel } from "../agents/registry.ts";
import { executeAgent } from "../agents/executor.ts";
import { guardTiming } from "../utils/timing-guard.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Agents that participate in standup (exclude wellness for privacy)
const STANDUP_AGENTS = [
  "cio",
  "cfo",
  "cmo",
  "head-content",
  "head-education",
  "head-household",
  "head-newsroom",
  "ciso",
];

interface AgentUpdate {
  agentId: string;
  agentName: string;
  model: string;
  response: string;
  costCents: number;
}

async function getAgentUpdate(agentId: string): Promise<AgentUpdate | null> {
  const agent = await getAgent(agentId);
  if (!agent) return null;

  const prompt =
    `This is the Monday team standup. Provide a brief update (3-5 bullet points max):\n\n` +
    `1. What you completed or monitored last week\n` +
    `2. What's planned this week\n` +
    `3. Any blockers, decisions needed, or flags for other team members\n\n` +
    `Be concise and specific. No fluff. If nothing notable happened in your area, say so briefly.`;

  try {
    const result = await executeAgent(agent, prompt, {
      supabase,
      taskType: "standup",
    });

    return {
      agentId: agent.id,
      agentName: agent.name,
      model: result.model,
      response: stripEmDashes(result.response),
      costCents: result.costCents,
    };
  } catch (error) {
    console.error(`[${agentId}] Standup update failed:`, error);
    return {
      agentId,
      agentName: agent.name,
      model: "error",
      response: "Update unavailable - agent error.",
      costCents: 0,
    };
  }
}

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  guardTiming("monday-standup", { days: [1], earliest: "9:15", latest: "9:45" });
  console.log("Starting Monday standup...");

  // Create meeting record
  let meetingId: string | undefined;
  if (supabase) {
    const { data } = await supabase
      .from("meetings")
      .insert({
        type: "standup",
        topic: "Weekly Monday Standup",
        status: "in_progress",
        autonomy_tier: 1,
        max_rounds: 1,
      })
      .select("id")
      .single();
    meetingId = data?.id;
  }

  // Collect updates from all agents (2 at a time due to concurrency limiter)
  const updates: AgentUpdate[] = [];
  const transcript: any[] = [];

  for (let i = 0; i < STANDUP_AGENTS.length; i += 2) {
    const batch = STANDUP_AGENTS.slice(i, i + 2);
    const results = await Promise.all(batch.map(getAgentUpdate));
    for (const result of results) {
      if (result) {
        updates.push(result);
        transcript.push({
          agent_id: result.agentId,
          agent_name: result.agentName,
          model: result.model,
          round: 1,
          type: "update",
          content: result.response,
          cost_cents: result.costCents,
        });
      }
    }
  }

  // COO synthesizes all updates
  console.log("COO synthesizing standup...");
  const coo = await getAgent("coo");
  if (!coo) {
    console.error("COO agent not found");
    process.exit(1);
  }

  const updateSummaries = updates
    .map((u) => `**${u.agentName} (${u.agentId}):**\n${u.response}`)
    .join("\n\n---\n\n");

  const synthesisPrompt =
    `You are moderating the Monday standup. Below are updates from all team members.\n\n` +
    `${updateSummaries}\n\n` +
    `Synthesize into a structured team update for Crevita:\n` +
    `1. Top priorities this week (max 5)\n` +
    `2. Key accomplishments from last week\n` +
    `3. Cross-department flags or conflicts (if any)\n` +
    `4. Decisions needed from Crevita (if any)\n\n` +
    `Keep it concise and actionable. No fluff.`;

  const synthesis = await executeAgent(coo, synthesisPrompt, {
    supabase,
    taskType: "review",
  });

  transcript.push({
    agent_id: "coo",
    agent_name: "Tamille",
    model: synthesis.model,
    round: 1,
    type: "synthesis",
    content: synthesis.response,
    cost_cents: synthesis.costCents,
  });

  // Save meeting record
  if (supabase && meetingId) {
    await supabase
      .from("meetings")
      .update({
        status: "completed",
        rounds_completed: 1,
        transcript: JSON.stringify(transcript),
        synthesis: synthesis.response,
        completed_at: new Date().toISOString(),
        metadata: {
          agent_count: updates.length,
          total_cost_cents: transcript.reduce(
            (s: number, t: any) => s + (t.cost_cents || 0),
            0
          ),
        },
      })
      .eq("id", meetingId);
  }

  // Send to Telegram as a clean thread
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  // First message: synthesis
  const headerMsg = stripEmDashes(
    `*Monday Standup - ${dateStr}*\n\n` + synthesis.response
  );
  const headerResult = await sendTelegram(headerMsg, { parseMode: "Markdown" });

  // Send individual updates as reply thread (if supported)
  for (const update of updates) {
    const msg = stripEmDashes(`*[${update.agentName}]*\n${update.response}`);

    // Small delay to avoid Telegram rate limits
    await new Promise((r) => setTimeout(r, 500));

    await sendTelegram(msg, { parseMode: "Markdown" });
  }

  const totalCost = transcript.reduce(
    (s: number, t: any) => s + (t.cost_cents || 0),
    0
  );
  console.log(
    `Monday standup complete. ${updates.length} agents, $${(totalCost / 100).toFixed(2)} total cost.`
  );
}

main();
