/**
 * Ad Hoc Meeting System
 *
 * /meeting [topic] triggers a multi-agent discussion:
 * 1. Each relevant agent weighs in from their perspective
 * 2. Agents can respond to each other (max 3 rounds)
 * 3. COO moderates and presents final recommendation
 * 4. Recommendation is Tier 2 (user approves before action)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bot } from "grammy";
import { getAgent, type AgentConfig } from "../agents/registry.ts";
import { executeAgent } from "../agents/executor.ts";
import { stripEmDashes } from "../utils/telegram.ts";

const CHAT_ID = process.env.TELEGRAM_USER_ID || "";
const MAX_ROUNDS = 3;

// All agents that can participate in ad hoc meetings
const ALL_AGENTS = [
  "cio",
  "cfo",
  "cmo",
  "head-content",
  "head-education",
  "head-household",
  "head-newsroom",
  "ciso",
];

interface TranscriptEntry {
  agent_id: string;
  agent_name: string;
  model: string;
  round: number;
  type: "perspective" | "response" | "synthesis";
  content: string;
  cost_cents: number;
}

/**
 * Determine which agents are relevant to a topic.
 * COO (Tamille) uses Opus to select the right agents.
 */
async function selectRelevantAgents(
  topic: string,
  supabase: SupabaseClient | null
): Promise<string[]> {
  const coo = await getAgent("coo");
  if (!coo) return ALL_AGENTS.slice(0, 4); // fallback

  const agentList = ALL_AGENTS.map((id) => {
    const roles: Record<string, string> = {
      cio: "CIO - Tech infrastructure, systems, AI tooling",
      cfo: "CFO - Revenue, costs, financial strategy",
      cmo: "CMO - Marketing, funnels, social media, branding",
      "head-content": "Head of Content - Writing, brand voice, publications",
      "head-education": "Head of Education - Thomas's school, tutoring",
      "head-household": "Head of Household - Bills, home, co-parenting",
      "head-newsroom": "Head of News Room - AI industry news, trends",
      ciso: "CISO - Security, red-teaming, privacy",
    };
    return `- ${id}: ${roles[id] || id}`;
  }).join("\n");

  const result = await executeAgent(
    coo,
    `Which agents should participate in a meeting about: "${topic}"?\n\n` +
      `Available agents:\n${agentList}\n\n` +
      `Return ONLY a comma-separated list of agent IDs (e.g., "cfo,cmo,cio"). ` +
      `Include only agents whose expertise is relevant. Minimum 2, maximum 6.`,
    { supabase, taskType: "review" }
  );

  // Parse the response to extract agent IDs
  const response = result.response.toLowerCase();
  const selected = ALL_AGENTS.filter(
    (id) => response.includes(id)
  );

  // Ensure at least 2 agents
  if (selected.length < 2) return ALL_AGENTS.slice(0, 3);
  return selected;
}

/**
 * Run an ad hoc meeting.
 * Returns the meeting ID for dashboard viewing.
 */
export async function runAdHocMeeting(opts: {
  bot: Bot;
  supabase: SupabaseClient;
  topic: string;
}): Promise<string | null> {
  const { bot, supabase, topic } = opts;

  // Create meeting record
  const { data: meetingData } = await supabase
    .from("meetings")
    .insert({
      type: "adhoc",
      topic,
      status: "in_progress",
      autonomy_tier: 2,
      max_rounds: MAX_ROUNDS,
    })
    .select("id")
    .single();

  const meetingId = meetingData?.id;
  if (!meetingId) return null;

  const transcript: TranscriptEntry[] = [];

  // Notify user that meeting is starting
  await bot.api.sendMessage(
    CHAT_ID,
    stripEmDashes(`*Meeting Started*\n_Topic: ${topic}_\n\nSelecting relevant agents...`),
    { parse_mode: "Markdown" }
  );

  // Step 1: Select relevant agents
  const relevantIds = await selectRelevantAgents(topic, supabase);
  const agents: AgentConfig[] = [];
  for (const id of relevantIds) {
    const agent = await getAgent(id);
    if (agent) agents.push(agent);
  }

  const agentNames = agents.map((a) => a.name).join(", ");
  await bot.api.sendMessage(
    CHAT_ID,
    stripEmDashes(`Participants: ${agentNames}\nCollecting perspectives...`),
    { parse_mode: "Markdown" }
  );

  // Step 2: Round 1 - Each agent weighs in
  const round1Responses: { agent: AgentConfig; response: string }[] = [];

  // Execute 2 at a time (concurrency limiter)
  for (let i = 0; i < agents.length; i += 2) {
    const batch = agents.slice(i, i + 2);
    const results = await Promise.all(
      batch.map(async (agent) => {
        const result = await executeAgent(
          agent,
          `You are in an executive meeting. The topic is: "${topic}"\n\n` +
            `Provide your perspective from your area of expertise. Be specific and actionable.\n` +
            `Include: your position on the topic, key considerations from your domain, and any risks or opportunities.\n` +
            `Keep it to 3-5 key points. Be direct.`,
          { supabase }
        );
        return { agent, result };
      })
    );

    for (const { agent, result } of results) {
      const cleaned = stripEmDashes(result.response);
      round1Responses.push({ agent, response: cleaned });
      transcript.push({
        agent_id: agent.id,
        agent_name: agent.name,
        model: result.model,
        round: 1,
        type: "perspective",
        content: cleaned,
        cost_cents: result.costCents,
      });
    }
  }

  // Update meeting progress
  await supabase
    .from("meetings")
    .update({ rounds_completed: 1, transcript: JSON.stringify(transcript) })
    .eq("id", meetingId);

  // Step 3: Round 2 - Agents respond to each other
  const round1Summary = round1Responses
    .map((r) => `**${r.agent.name}:** ${r.response}`)
    .join("\n\n---\n\n");

  const round2Responses: { agent: AgentConfig; response: string }[] = [];

  for (let i = 0; i < agents.length; i += 2) {
    const batch = agents.slice(i, i + 2);
    const results = await Promise.all(
      batch.map(async (agent) => {
        const result = await executeAgent(
          agent,
          `Executive meeting on: "${topic}"\n\n` +
            `Here are all team members' initial perspectives:\n\n${round1Summary}\n\n` +
            `Now respond briefly: Do you agree or disagree with any points? ` +
            `Any counter-proposals or additions based on what others said?\n` +
            `Be concise - 2-3 points max. If you fully agree with the group, say so briefly.`,
          { supabase }
        );
        return { agent, result };
      })
    );

    for (const { agent, result } of results) {
      const cleaned = stripEmDashes(result.response);
      round2Responses.push({ agent, response: cleaned });
      transcript.push({
        agent_id: agent.id,
        agent_name: agent.name,
        model: result.model,
        round: 2,
        type: "response",
        content: cleaned,
        cost_cents: result.costCents,
      });
    }
  }

  await supabase
    .from("meetings")
    .update({ rounds_completed: 2, transcript: JSON.stringify(transcript) })
    .eq("id", meetingId);

  // Step 4: COO synthesizes
  const coo = await getAgent("coo");
  if (!coo) {
    await bot.api.sendMessage(CHAT_ID, "COO unavailable for synthesis.");
    return meetingId;
  }

  const round2Summary = round2Responses
    .map((r) => `**${r.agent.name}:** ${r.response}`)
    .join("\n\n---\n\n");

  const synthesisResult = await executeAgent(
    coo,
    `You are moderating an executive meeting on: "${topic}"\n\n` +
      `=== ROUND 1: Initial Perspectives ===\n${round1Summary}\n\n` +
      `=== ROUND 2: Responses & Counter-proposals ===\n${round2Summary}\n\n` +
      `Synthesize this discussion into a final recommendation for Crevita:\n\n` +
      `1. **Recommendation**: Your recommended course of action (be specific)\n` +
      `2. **Consensus view**: Where the team agrees\n` +
      `3. **Dissenting opinions**: Any notable disagreements or concerns (with who raised them)\n` +
      `4. **Next steps**: Concrete actions if Crevita approves\n\n` +
      `Be direct and actionable. This is a decision brief, not a summary.`,
    { supabase, taskType: "review" }
  );

  const synthesisClean = stripEmDashes(synthesisResult.response);
  transcript.push({
    agent_id: "coo",
    agent_name: "Tamille",
    model: synthesisResult.model,
    round: 3,
    type: "synthesis",
    content: synthesisClean,
    cost_cents: synthesisResult.costCents,
  });

  // Build consensus object
  const consensus: Record<string, string> = {};
  for (const r of round2Responses) {
    const lower = r.response.toLowerCase();
    if (lower.includes("disagree") || lower.includes("counter")) {
      consensus[r.agent.id] = "dissent";
    } else if (lower.includes("agree") || lower.includes("support")) {
      consensus[r.agent.id] = "agree";
    } else {
      consensus[r.agent.id] = "neutral";
    }
  }

  // Save completed meeting
  const totalCost = transcript.reduce((s, t) => s + (t.cost_cents || 0), 0);
  await supabase
    .from("meetings")
    .update({
      status: "completed",
      rounds_completed: 3,
      transcript: JSON.stringify(transcript),
      synthesis: synthesisClean,
      recommendation: synthesisClean,
      consensus: JSON.stringify(consensus),
      completed_at: new Date().toISOString(),
      metadata: {
        agents: relevantIds,
        total_cost_cents: totalCost,
      },
    })
    .eq("id", meetingId);

  // Send recommendation to Telegram with Tier 2 approval buttons
  const recMsg = stripEmDashes(
    `*Meeting Complete: ${topic}*\n\n` +
      `_Participants: ${agentNames}_\n` +
      `_Rounds: 2 discussion + synthesis_\n` +
      `_Cost: $${(totalCost / 100).toFixed(2)}_\n\n` +
      `---\n\n` +
      `*Tamille's Recommendation:*\n\n${synthesisClean.substring(0, 3000)}`
  );

  await bot.api.sendMessage(CHAT_ID, recMsg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve Recommendation", callback_data: `meeting_approve:${meetingId}` },
          { text: "Reject", callback_data: `meeting_reject:${meetingId}` },
        ],
      ],
    },
  });

  console.log(
    `Ad hoc meeting complete. ${agents.length} agents, 2 rounds, $${(totalCost / 100).toFixed(2)}.`
  );

  return meetingId;
}
