/**
 * Tweet Flow -- Conversational tweet drafting and posting via Telegram
 *
 * Trigger: "draft tweets" or "tweet drafts" in Telegram
 * Flow:
 *   1. Claude searches for top AI news from the last 24 hours
 *   2. Drafts 3-5 tweets in Crevita's voice
 *   3. Sends numbered drafts to Telegram with character counts
 *   4. User replies with selections (e.g. "post 1 and 3")
 *   5. Posts selected tweets via twitter-browser.ts
 *   6. Confirms in Telegram with link
 *
 * Pending drafts are stored in .claude/tweet-drafts-pending.json so context
 * survives between messages.
 */

import { spawnSync } from "bun";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { postTweet as browserPostTweet } from "../utils/twitter-browser.ts";
import { postTweet as apiPostTweet } from "../utils/twitter.ts";
import { stripEmDashes } from "../utils/telegram.ts";

const PROJECT_ROOT = join(import.meta.dir, "../..");
const DRAFTS_FILE = join(PROJECT_ROOT, ".claude/tweet-drafts-pending.json");
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// ============================================================
// DRAFT PERSISTENCE
// ============================================================

interface TweetDraft {
  index: number;
  headline: string;
  tweet: string;
  charCount: number;
}

interface PendingDrafts {
  drafts: TweetDraft[];
  createdAt: string;
}

function saveDrafts(drafts: TweetDraft[]): void {
  const dir = join(PROJECT_ROOT, ".claude");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const pending: PendingDrafts = {
    drafts,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(DRAFTS_FILE, JSON.stringify(pending, null, 2));
  console.log(`[tweet-flow] Saved ${drafts.length} drafts to ${DRAFTS_FILE}`);
}

function loadDrafts(): TweetDraft[] | null {
  if (!existsSync(DRAFTS_FILE)) return null;

  try {
    const raw = readFileSync(DRAFTS_FILE, "utf-8");
    const pending: PendingDrafts = JSON.parse(raw);

    // Expire drafts older than 24 hours
    const age = Date.now() - new Date(pending.createdAt).getTime();
    if (age > 24 * 60 * 60 * 1000) {
      console.log("[tweet-flow] Drafts expired (older than 24h)");
      clearDrafts();
      return null;
    }

    return pending.drafts;
  } catch {
    return null;
  }
}

function clearDrafts(): void {
  if (existsSync(DRAFTS_FILE)) {
    writeFileSync(DRAFTS_FILE, "{}");
  }
}

// ============================================================
// TRIGGER DETECTION
// ============================================================

export function isTweetFlowTrigger(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return lower === "draft tweets" || lower === "tweet drafts";
}

export function isPostSelectionReply(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Matches patterns like "post 1 and 3", "post 1, 3", "post 2", "1 and 3", "post all"
  return /^(post\s+)?(\d[\d,\s]*(?:and\s+\d+)?|all)$/i.test(lower.replace(/,/g, " "));
}

// ============================================================
// GENERATE DRAFTS
// ============================================================

export async function generateDrafts(): Promise<{ drafts: TweetDraft[]; error?: string }> {
  console.log("[tweet-flow] Generating tweet drafts via Claude CLI...");

  const prompt = `You are a research assistant. Search the web for the top 3-5 AI news stories from the last 24 hours. For each story, draft a tweet (under 280 characters) in the voice of Crevita -- a mom, STEM educator, and business owner who makes AI accessible and relatable for parents and small business owners. The tone should be warm, encouraging, and non-technical. Include relevant hashtags.

IMPORTANT: Do NOT use em dashes (--) anywhere. Use commas or periods instead.
IMPORTANT: Each tweet MUST be under 280 characters including hashtags.

Return your response as a JSON array with this exact format:
[
  {
    "headline": "Short headline describing the news story",
    "tweet": "The full tweet text under 280 characters with hashtags"
  }
]

Return ONLY the JSON array, no markdown fences, no extra text.`;

  const proc = spawnSync([CLAUDE_PATH, "-p", prompt, "--model", "sonnet", "--output-format", "text"], {
    timeout: 180_000,
    cwd: PROJECT_ROOT,
  });

  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    console.error(`[tweet-flow] Claude CLI failed (exit ${proc.exitCode}): ${stderr}`);
    return { drafts: [], error: "Claude CLI failed to generate drafts" };
  }

  const raw = new TextDecoder().decode(proc.stdout).trim();

  let parsed: Array<{ headline: string; tweet: string }>;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[tweet-flow] Failed to parse Claude response:", raw.substring(0, 500));
    return { drafts: [], error: "Could not parse draft response" };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { drafts: [], error: "No drafts generated" };
  }

  const drafts: TweetDraft[] = parsed.map((d, i) => ({
    index: i + 1,
    headline: stripEmDashes(d.headline),
    tweet: stripEmDashes(d.tweet),
    charCount: d.tweet.length,
  }));

  saveDrafts(drafts);
  return { drafts };
}

// ============================================================
// FORMAT DRAFTS FOR TELEGRAM
// ============================================================

export function formatDraftsMessage(drafts: TweetDraft[]): string {
  let msg = "TWEET DRAFTS\n\n";

  for (const d of drafts) {
    msg += `${d.index}. ${d.headline}\n`;
    msg += `${d.tweet}\n`;
    msg += `(${d.charCount} chars)\n\n`;
  }

  msg += 'Reply with which to post (e.g. "post 1 and 3" or "post all")';
  return msg;
}

// ============================================================
// PARSE SELECTION
// ============================================================

export function parseSelection(text: string, totalDrafts: number): number[] {
  const lower = text.toLowerCase().trim();

  if (lower.includes("all")) {
    return Array.from({ length: totalDrafts }, (_, i) => i + 1);
  }

  // Extract all numbers from the text
  const numbers = lower.match(/\d+/g);
  if (!numbers) return [];

  return numbers
    .map((n) => parseInt(n))
    .filter((n) => n >= 1 && n <= totalDrafts);
}

// ============================================================
// POST SELECTED TWEETS
// ============================================================

export async function postSelectedTweets(
  indices: number[]
): Promise<Array<{ index: number; tweet: string; success: boolean; error?: string }>> {
  const drafts = loadDrafts();
  if (!drafts) {
    return [{ index: 0, tweet: "", success: false, error: "No pending drafts found" }];
  }

  const results: Array<{ index: number; tweet: string; success: boolean; error?: string }> = [];

  for (const idx of indices) {
    const draft = drafts.find((d) => d.index === idx);
    if (!draft) {
      results.push({ index: idx, tweet: "", success: false, error: "Draft not found" });
      continue;
    }

    // Try API first (more reliable, gives us a tweet ID/URL), fall back to browser
    const apiResult = await apiPostTweet(draft.tweet);

    if (apiResult) {
      results.push({
        index: idx,
        tweet: draft.tweet,
        success: true,
      });
      console.log(`[tweet-flow] Tweet ${idx} posted via API (ID: ${apiResult.id})`);
    } else {
      // Fallback to browser automation
      console.log(`[tweet-flow] API failed for tweet ${idx}, trying browser...`);
      const browserResult = await browserPostTweet(draft.tweet);
      results.push({
        index: idx,
        tweet: draft.tweet,
        success: browserResult.success,
        error: browserResult.error,
      });
    }

    // Small delay between posts to avoid rate limiting
    if (indices.indexOf(idx) < indices.length - 1) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Clear drafts after posting
  clearDrafts();

  return results;
}

// ============================================================
// FORMAT POSTING RESULTS
// ============================================================

export function formatPostResults(
  results: Array<{ index: number; tweet: string; success: boolean; error?: string }>
): string {
  let msg = "";

  for (const r of results) {
    if (r.success) {
      msg += `Tweet ${r.index}: Posted\n`;
      msg += `https://x.com/PlayhouseSTEM\n\n`;
    } else {
      msg += `Tweet ${r.index}: Failed -- ${r.error || "unknown error"}\n\n`;
    }
  }

  const successCount = results.filter((r) => r.success).length;
  msg += `${successCount}/${results.length} tweets posted.`;

  return msg;
}

// ============================================================
// MAIN HANDLER (called from relay.ts)
// ============================================================

export async function handleTweetFlow(
  sendReply: (text: string) => Promise<void>,
  userText: string
): Promise<void> {
  // Check if this is a trigger to generate new drafts
  if (isTweetFlowTrigger(userText)) {
    await sendReply("Searching for today's top AI news and drafting tweets...");

    const { drafts, error } = await generateDrafts();
    if (error || drafts.length === 0) {
      await sendReply(`Failed to generate drafts: ${error || "no results"}`);
      return;
    }

    await sendReply(formatDraftsMessage(drafts));
    return;
  }

  // Check if this is a post selection reply
  if (isPostSelectionReply(userText)) {
    const drafts = loadDrafts();
    if (!drafts || drafts.length === 0) {
      await sendReply("No pending tweet drafts. Send \"draft tweets\" to generate new ones.");
      return;
    }

    const indices = parseSelection(userText, drafts.length);
    if (indices.length === 0) {
      await sendReply("Could not parse your selection. Try something like \"post 1 and 3\" or \"post all\".");
      return;
    }

    const selected = drafts.filter((d) => indices.includes(d.index));
    let preview = "Posting these tweets:\n\n";
    for (const d of selected) {
      preview += `${d.index}. ${d.tweet.substring(0, 60)}...\n`;
    }
    await sendReply(preview);

    const results = await postSelectedTweets(indices);
    await sendReply(formatPostResults(results));
    return;
  }
}

// ============================================================
// CHECK IF PENDING DRAFTS EXIST (for relay routing)
// ============================================================

export function hasPendingDrafts(): boolean {
  return loadDrafts() !== null;
}
