/**
 * Twitter Drafts Worker (Hook Point Edition)
 *
 * Daily 5 AM PT briefing. Uses Claude CLI to scan AI news sources
 * (3-tier priority), draft 3 post options using Hook Point framework,
 * and send formatted options to Telegram for approval. No auto-posting.
 *
 * Skill files:
 *   skills/twitter-posting/SKILL.md
 *   skills/twitter-posting/references/voice-and-hooks.md
 *
 * Schedule: 0 5 * * * (5 AM PT)
 * Run: bun run src/workers/twitter-drafts.ts
 */

import { spawnSync } from "bun";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { sendTelegram, stripEmDashes } from "../utils/telegram.ts";
import { guardTiming } from "../utils/timing-guard.ts";

const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const LABEL = "twitter-drafts";
const FLAG_FILE = join(PROJECT_ROOT, "data", "twitter-draft-status.json");

// ============================================================
// FLAG FILE (dedup + nudge coordination)
// ============================================================

interface DraftStatus {
  date: string;
  drafted: boolean;
  responded: boolean;
  status: "pending" | "nudged" | "approved" | "skipped";
}

function getTodayDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function readFlagFile(): Promise<DraftStatus | null> {
  try {
    const raw = await readFile(FLAG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFlagFile(status: DraftStatus): Promise<void> {
  const dir = join(PROJECT_ROOT, "data");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(FLAG_FILE, JSON.stringify(status, null, 2), "utf-8");
}

// ============================================================
// CHARACTER COUNT VALIDATION
// ============================================================

function countChars(text: string): number {
  // URLs count as 23 characters (X's t.co wrapping)
  let normalized = text.replace(/https?:\/\/\S+/g, "x".repeat(23));
  // Emoji count as 2 characters each (rough heuristic for astral plane chars)
  let count = 0;
  for (const char of normalized) {
    count += char.codePointAt(0)! > 0xffff ? 2 : 1;
  }
  return count;
}

// ============================================================
// PROMPT
// ============================================================

const PROMPT = `You are Crevita Moody's X/Twitter content assistant. Before drafting, you must follow these instructions exactly.

Read and internalize these two files:
1. skills/twitter-posting/SKILL.md (the full posting skill with source tiers, story selection, and format templates)
2. skills/twitter-posting/references/voice-and-hooks.md (voice profile and 7 Hook Point structures)

Now scan the web for AI news from the last 24 hours. Use this source priority:

TIER 1 (check first):
- arXiv (cs.AI, cs.CL, cs.LG) for new papers
- Official blogs: Anthropic, OpenAI, Google DeepMind, Meta AI, Mistral, xAI
- TechCrunch AI section
- The Verge AI section
- Reuters Technology
- MIT Technology Review

TIER 2 (secondary):
- Ars Technica, Wired AI, VentureBeat AI
- AI newsletters (The Batch, Import AI, The Rundown AI)

TIER 3 (social signal):
- Trending AI topics on X
- Notable AI researcher posts

Select exactly 3 stories that are DISTINCT from each other. Aim for variety across these categories:
1. Product/Launch
2. Research/Breakthrough
3. Policy/Ethics/Safety
4. Industry Move
5. Accessibility/Education

If all top stories cluster in one category, pick the top 3 but note this.

For each story, draft a post using one of the 7 Hook Point structures from the voice reference:
1. The Contrarian
2. The Curiosity Gap
3. The Specificity Hook
4. The "So What?" Reframe
5. The Pattern Interrupt
6. The Stakes Reveal
7. The Simple Truth

Match hook type to story type per the table in the reference. Write in Crevita's voice: conversational, credible, opinionated but fair. Like a smart friend texting about something she just read.

CRITICAL RULES:
- Hard limit: 280 characters per post. URLs count as 23 characters. Emoji count as 2 characters each
- NEVER use em dashes. Use commas, periods, semicolons, or "and" instead
- No hashtag spam (one max, only if it adds genuine value)
- No emoji overload (one max, only if it serves the hook)
- No hype language: "game-changer," "revolutionary," "buckle up," "the future is here"
- Always include the source article link
- Source attribution required

Return your response as a JSON array with exactly 3 items in this format:
[
  {
    "option": 1,
    "format": "Single Post",
    "story": "1-line summary of the news",
    "source_name": "Publication name",
    "source_url": "https://...",
    "draft": "The actual post text including the link",
    "hook_type": "Which of the 7 hook structures used",
    "category": "Product/Launch | Research | Policy/Ethics | Industry Move | Accessibility",
    "why": "1 sentence on why this story is worth posting"
  }
]

Return ONLY the JSON array, no markdown fences, no extra text.`;

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  guardTiming(LABEL, { earliest: "4:45", latest: "5:30" });

  // Dedup guard: check if we already sent drafts today
  const existing = await readFlagFile();
  const today = getTodayDateStr();
  if (existing && existing.date === today && existing.drafted) {
    console.log(`[${LABEL}] Drafts already sent today (${today}). Exiting.`);
    process.exit(0);
  }

  console.log(`[${LABEL}] Starting daily Hook Point draft generation...`);

  // Call Claude CLI with the skill-aware prompt
  const proc = spawnSync(
    [CLAUDE_PATH, "-p", PROMPT, "--model", "sonnet", "--output-format", "text"],
    {
      timeout: 300_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: PROJECT_ROOT,
    }
  );

  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    console.error(`[${LABEL}] Claude CLI failed (exit ${proc.exitCode}): ${stderr}`);
    await sendTelegram(`[${LABEL}] Failed to generate tweet drafts. Check logs.`);
    process.exit(1);
  }

  const raw = new TextDecoder().decode(proc.stdout).trim();
  console.log(`[${LABEL}] Raw response length: ${raw.length}`);

  // Parse the JSON response
  interface DraftOption {
    option: number;
    format: string;
    story: string;
    source_name: string;
    source_url: string;
    draft: string;
    hook_type: string;
    category: string;
    why: string;
  }

  let drafts: DraftOption[];
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
    drafts = JSON.parse(cleaned);
  } catch (err) {
    console.error(`[${LABEL}] Failed to parse Claude response as JSON:`, err);
    console.error(`[${LABEL}] Raw output:`, raw.substring(0, 500));
    await sendTelegram(`[${LABEL}] Got a response but couldn't parse it. Check logs.`);
    process.exit(1);
  }

  if (!Array.isArray(drafts) || drafts.length === 0) {
    console.error(`[${LABEL}] No drafts returned`);
    await sendTelegram(`[${LABEL}] No tweet drafts generated. Check logs.`);
    process.exit(1);
  }

  console.log(`[${LABEL}] Got ${drafts.length} drafts`);

  // Validate character counts and scrub em dashes
  for (const d of drafts) {
    d.draft = stripEmDashes(d.draft);
    const chars = countChars(d.draft);
    if (chars > 280) {
      console.warn(`[${LABEL}] Option ${d.option} is ${chars}/280 chars, over limit. Flagging.`);
      d.draft += ` [OVER LIMIT: ${chars}/280, needs trim]`;
    }
  }

  // Format Telegram message using the SKILL.md template
  let message = "DAILY X POST OPTIONS\n\n";

  // Check category diversity
  const categories = drafts.map((d) => d.category);
  const unique = new Set(categories);
  if (unique.size === 1) {
    message += `Heavy news day in ${categories[0]}, here are the top 3.\n\n`;
  }

  for (const d of drafts) {
    const chars = countChars(d.draft);
    message += `OPTION ${d.option}\n`;
    message += `Format: ${d.format}\n`;
    message += `Story: ${d.story}\n`;
    message += `Source: ${d.source_name} ${d.source_url}\n`;
    message += `Hook: ${d.hook_type}\n\n`;
    message += `Draft:\n${d.draft}\n\n`;
    message += `[Character count: ${chars}/280]\n\n`;
    message += `Why this story: ${d.why}\n`;
    message += `---\n\n`;
  }

  message += "Which one(s) do you want to go with? I can also revise or combine.";

  // Final em dash scrub on the entire message
  message = stripEmDashes(message);

  const result = await sendTelegram(message);

  if (result.ok) {
    console.log(`[${LABEL}] Drafts sent to Telegram successfully`);

    // Write flag file for nudge coordination
    await writeFlagFile({
      date: today,
      drafted: true,
      responded: false,
      status: "pending",
    });
    console.log(`[${LABEL}] Flag file written: ${today} = pending`);
  } else {
    console.error(`[${LABEL}] Failed to send drafts to Telegram`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[${LABEL}] Fatal error:`, err);
  process.exit(1);
});
