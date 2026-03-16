/**
 * News Room — Digest Worker
 *
 * Daily digest (7:30am PT): top 5 stories from the last 24 hours
 * Weekly deep dive (Saturday 9am PT): week's most significant developments
 *
 * Run: bun run src/workers/newsroom-digest.ts [daily|weekly]
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "bun";
import { sendTelegram } from "../utils/telegram.ts";
import { guardTiming } from "../utils/timing-guard.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ============================================================
// DAILY DIGEST
// ============================================================

async function dailyDigest(): Promise<void> {
  if (!supabase) {
    console.error("Supabase not configured");
    return;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: items } = await supabase
    .from("news_items")
    .select("*")
    .gte("created_at", since)
    .order("importance", { ascending: false })
    .limit(20);

  if (!items || items.length === 0) {
    await sendTelegram(
      "*[News Room] Daily Digest*\n\nNo new AI news in the last 24 hours.",
      { parseMode: "Markdown" }
    );
    return;
  }

  // Use Sonnet to curate top 5
  const itemList = items
    .map((item: any, i: number) =>
      `${i + 1}. [${item.category}] "${item.title}" (importance: ${item.importance}) — ${item.summary || "no summary"}`
    )
    .join("\n");

  const prompt = `You are the Head of News Room for Crevita, an FAA data scientist and founder of Playhouse STEM (early childhood AI education).

Pick the top 5 most relevant stories from this list and write a concise daily digest. Lead with the single most important story.

Format each as:
1. **Title** (Source)
   One-sentence summary explaining why it matters.

End with a one-line takeaway.

NEVER use em dashes. Use commas, colons, or semicolons instead.

Stories:
${itemList}`;

  try {
    const proc = spawnSync(
      [CLAUDE_PATH, "-p", prompt, "--model", "sonnet", "--output-format", "text"],
      { timeout: 45000 }
    );

    const digest = new TextDecoder().decode(proc.stdout).trim();

    if (!digest) {
      console.error("Empty digest from Claude");
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/Los_Angeles",
    });

    const message = `*[News Room] Daily AI Digest*\n${dateStr}\n\n${digest}`;
    await sendTelegram(message, { parseMode: "Markdown" });

    // Mark items as included in digest
    const includedIds = items.slice(0, 10).map((i: any) => i.id);
    await supabase
      .from("news_items")
      .update({ included_in_digest: true })
      .in("id", includedIds);

    console.log("Daily digest sent.");
  } catch (e: any) {
    console.error("Digest generation failed:", e.message);
  }
}

// ============================================================
// WEEKLY DEEP DIVE
// ============================================================

async function weeklyDeepDive(): Promise<void> {
  if (!supabase) {
    console.error("Supabase not configured");
    return;
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: items } = await supabase
    .from("news_items")
    .select("*")
    .gte("created_at", since)
    .order("importance", { ascending: false })
    .limit(50);

  if (!items || items.length === 0) {
    await sendTelegram(
      "*[News Room] Weekly Deep Dive*\n\nNo AI news collected this week.",
      { parseMode: "Markdown" }
    );
    return;
  }

  // Group by category for the prompt
  const byCategory: Record<string, any[]> = {};
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  let itemList = "";
  for (const [cat, catItems] of Object.entries(byCategory)) {
    itemList += `\n[${cat.replace("_", " ").toUpperCase()}]\n`;
    catItems.slice(0, 10).forEach((item: any, i: number) => {
      itemList += `- "${item.title}" (${item.source_name}, importance: ${item.importance}) — ${item.summary || ""}\n`;
    });
  }

  const prompt = `You are the Head of News Room for Crevita, an FAA data scientist and founder of Playhouse STEM.

Write a weekly deep dive summarizing this week's most significant AI developments. Structure it as:

1. **The Big Story** — the single most important development this week
2. **Direct Impact** — anything affecting FAA/aviation or education technology
3. **Model Releases and Updates** — new models, capabilities, benchmarks
4. **Research Highlights** — notable papers worth reading
5. **Policy and Regulation** — government actions on AI
6. **What to Watch Next Week** — emerging trends or upcoming events

Be concise but substantive. Skip any section with no relevant items.
NEVER use em dashes. Use commas, colons, or semicolons instead.

This week's news:
${itemList}`;

  try {
    const proc = spawnSync(
      [CLAUDE_PATH, "-p", prompt, "--model", "sonnet", "--output-format", "text"],
      { timeout: 60000 }
    );

    const deepDive = new TextDecoder().decode(proc.stdout).trim();

    if (!deepDive) {
      console.error("Empty deep dive from Claude");
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    });

    const message = `*[News Room] Weekly Deep Dive*\nWeek of ${dateStr}\n\n${deepDive}`;

    // Split if too long for Telegram
    if (message.length > 4000) {
      const mid = message.lastIndexOf("\n\n", 3800);
      await sendTelegram(message.substring(0, mid), { parseMode: "Markdown" });
      await sendTelegram(message.substring(mid), { parseMode: "Markdown" });
    } else {
      await sendTelegram(message, { parseMode: "Markdown" });
    }

    console.log("Weekly deep dive sent.");
  } catch (e: any) {
    console.error("Deep dive generation failed:", e.message);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const mode = process.argv[2] || "daily";

  if (mode === "weekly") {
    guardTiming("newsroom-weekly", { days: [6], earliest: "8:45", latest: "9:15" });
    console.log("Building weekly deep dive...");
    await weeklyDeepDive();
  } else {
    guardTiming("newsroom-daily", { earliest: "7:15", latest: "7:45" });
    console.log("Building daily digest...");
    await dailyDigest();
  }
}

main();
