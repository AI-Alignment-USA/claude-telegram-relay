/**
 * Twitter Drafts Worker
 *
 * Runs daily at 7am ET. Uses Claude CLI to find the top 3-5 AI news stories
 * from the last 24 hours, then drafts tweet-length posts in Crevita's voice --
 * accessible, non-technical, focused on making AI relatable for parents and
 * business owners. Sends drafts to Telegram for review. No auto-posting.
 *
 * Schedule: 0 7 * * * (daily 7am ET)
 * Run: bun run src/workers/twitter-drafts.ts
 */

import { spawnSync } from "bun";
import { sendTelegram, stripEmDashes } from "../utils/telegram.ts";
import { guardTiming } from "../utils/timing-guard.ts";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const LABEL = "twitter-drafts";

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  guardTiming(LABEL, { earliest: "4:00", latest: "4:30" });

  console.log(`[${LABEL}] Starting daily tweet draft generation...`);

  // Step 1: Ask Claude to find top AI news and draft tweets
  const prompt = `You are a research assistant. Search the web for the top 3-5 AI news stories from the last 24 hours. For each story, draft a tweet (under 280 characters) in the voice of Crevita -- a mom, STEM educator, and business owner who makes AI accessible and relatable for parents and small business owners. The tone should be warm, encouraging, and non-technical. Include relevant hashtags.

IMPORTANT: Do NOT use em dashes anywhere. Use double hyphens (--) if you need a dash.

Return your response as a JSON array with this exact format:
[
  {
    "headline": "Short headline describing the news story",
    "tweet": "The full tweet text under 280 characters with hashtags"
  }
]

Return ONLY the JSON array, no markdown fences, no extra text.`;

  console.log(`[${LABEL}] Calling Claude CLI for news + drafts...`);

  const proc = spawnSync(
    [CLAUDE_PATH, "-p", prompt, "--model", "haiku", "--output-format", "text"],
    { timeout: 180_000 }
  );

  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    console.error(`[${LABEL}] Claude CLI failed (exit ${proc.exitCode}): ${stderr}`);
    await sendTelegram(`[${LABEL}] Failed to generate tweet drafts. Check logs.`);
    process.exit(1);
  }

  const raw = new TextDecoder().decode(proc.stdout).trim();
  console.log(`[${LABEL}] Raw response length: ${raw.length}`);

  // Step 2: Parse the JSON response
  let drafts: Array<{ headline: string; tweet: string }>;
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
    drafts = JSON.parse(cleaned);
  } catch (err) {
    console.error(`[${LABEL}] Failed to parse Claude response as JSON:`, err);
    console.error(`[${LABEL}] Raw output:`, raw);
    await sendTelegram(`[${LABEL}] Got a response but couldn't parse it. Check logs.`);
    process.exit(1);
  }

  if (!Array.isArray(drafts) || drafts.length === 0) {
    console.error(`[${LABEL}] No drafts returned`);
    await sendTelegram(`[${LABEL}] No tweet drafts generated. Check logs.`);
    process.exit(1);
  }

  console.log(`[${LABEL}] Got ${drafts.length} drafts`);

  // Step 3: Format and send to Telegram
  let message = "DAILY TWEET DRAFTS\n\n";

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const charCount = d.tweet.length;
    message += `${i + 1}. ${d.headline}\n`;
    message += `${d.tweet}\n`;
    message += `(${charCount} chars)\n\n`;
  }

  message += "Reply with the number(s) you want to post.";

  // Strip em dashes before sending
  message = stripEmDashes(message);

  const result = await sendTelegram(message);

  if (result.ok) {
    console.log(`[${LABEL}] Drafts sent to Telegram successfully`);
  } else {
    console.error(`[${LABEL}] Failed to send drafts to Telegram`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[${LABEL}] Fatal error:`, err);
  process.exit(1);
});
