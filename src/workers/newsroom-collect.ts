/**
 * News Room — Collection Worker
 *
 * Fetches RSS feeds, classifies items with Haiku, stores in Supabase.
 * Fires breaking alerts for importance >= 8.
 *
 * Schedule: every 2 hours, 7am-9pm PT
 * Run: bun run src/workers/newsroom-collect.ts
 */

import { XMLParser } from "fast-xml-parser";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "bun";
import { sendTelegram } from "../utils/telegram.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const xmlParser = new XMLParser({ ignoreAttributes: false });

// ============================================================
// RSS FEED LIST
// ============================================================

interface FeedConfig {
  url: string;
  name: string;
  category: string;
}

const FEEDS: FeedConfig[] = [
  // AI companies
  { url: "https://blog.anthropic.com/rss.xml", name: "Anthropic", category: "direct_impact" },
  { url: "https://openai.com/blog/rss.xml", name: "OpenAI", category: "industry_trends" },
  { url: "https://blog.google/technology/ai/rss/", name: "Google AI", category: "industry_trends" },
  { url: "https://ai.meta.com/blog/rss/", name: "Meta AI", category: "industry_trends" },
  // Research
  { url: "https://rss.arxiv.org/rss/cs.AI", name: "arXiv cs.AI", category: "research" },
  { url: "https://rss.arxiv.org/rss/cs.CL", name: "arXiv cs.CL", category: "research" },
  // Tech news
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", name: "The Verge", category: "industry_trends" },
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", name: "TechCrunch", category: "industry_trends" },
  { url: "https://feeds.arstechnica.com/arstechnica/technology-lab", name: "Ars Technica", category: "industry_trends" },
  { url: "https://www.wired.com/feed/tag/ai/latest/rss", name: "Wired", category: "industry_trends" },
];

// ============================================================
// RSS FETCHING
// ============================================================

interface RawItem {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  sourceName: string;
}

async function fetchFeed(feed: FeedConfig): Promise<RawItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "TamilleNewsRoom/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log(`  [skip] ${feed.name}: HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const parsed = xmlParser.parse(xml);

    // Handle both RSS and Atom formats
    const items =
      parsed.rss?.channel?.item ||
      parsed.feed?.entry ||
      parsed.rdf?.item ||
      [];

    const rawItems = (Array.isArray(items) ? items : [items])
      .slice(0, 5) // Max 5 per feed per collection
      .map((item: any) => ({
        title: item.title?.toString()?.trim() || "",
        link: item.link?.["@_href"] || item.link?.toString() || "",
        pubDate: item.pubDate || item.published || item.updated || "",
        description: (item.description || item.summary || "")
          .toString()
          .replace(/<[^>]*>/g, "")
          .substring(0, 500),
        sourceName: feed.name,
      }))
      .filter((item: RawItem) => item.title.length > 0);

    console.log(`  [ok] ${feed.name}: ${rawItems.length} items`);
    return rawItems;
  } catch (e: any) {
    console.log(`  [err] ${feed.name}: ${e.message}`);
    return [];
  }
}

// ============================================================
// DEDUPLICATION
// ============================================================

async function isAlreadyStored(title: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase
    .from("news_items")
    .select("id")
    .ilike("title", title.substring(0, 100))
    .limit(1);
  return (data?.length || 0) > 0;
}

// ============================================================
// CLASSIFICATION (Haiku — cheap, fast)
// ============================================================

interface ClassifiedItem {
  title: string;
  summary: string;
  category: "direct_impact" | "industry_trends" | "research" | "policy" | "breaking";
  importance: number;
}

async function classifyBatch(items: RawItem[]): Promise<ClassifiedItem[]> {
  if (items.length === 0) return [];

  const itemList = items
    .map((item, i) => `${i + 1}. "${item.title}" (${item.sourceName}) — ${item.description?.substring(0, 150) || "no description"}`)
    .join("\n");

  const prompt = `Classify these AI news items. For each, provide:
- category: direct_impact (affects FAA/aviation or early childhood ed tech), industry_trends (general AI), research (papers/models), policy (regulation/government), breaking (major releases/incidents)
- importance: 1-10 (10 = GPT-5 class release or major safety incident, 5 = notable, 1 = routine)
- summary: one sentence

Respond as JSON array: [{"index":1,"category":"...","importance":5,"summary":"..."},...]
ONLY output the JSON array, nothing else.

Items:
${itemList}`;

  try {
    const proc = spawnSync(
      [CLAUDE_PATH, "-p", prompt, "--model", "haiku", "--output-format", "text"],
      { timeout: 60000 }
    );

    const output = new TextDecoder().decode(proc.stdout).trim();

    // Extract JSON from response
    const jsonMatch = output.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.log("  Classification: no valid JSON, using fallback");
      // Fallback: store items with default classification
      return items.map((item) => ({
        title: item.title,
        summary: item.description?.substring(0, 200) || "",
        category: "industry_trends" as const,
        importance: 5,
      }));
    }

    const classified: any[] = JSON.parse(jsonMatch[0]);
    const validCategories = ["direct_impact", "industry_trends", "research", "policy", "breaking"];

    return classified.map((c: any) => ({
      title: items[(c.index || 1) - 1]?.title || "",
      summary: c.summary || "",
      category: validCategories.includes(c.category) ? c.category : "industry_trends",
      importance: Math.min(10, Math.max(1, c.importance || 5)),
    }));
  } catch (e: any) {
    console.log(`  Classification error: ${e.message}, using fallback`);
    return items.map((item) => ({
      title: item.title,
      summary: item.description?.substring(0, 200) || "",
      category: "industry_trends" as const,
      importance: 5,
    }));
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!supabase) {
    console.error("Supabase not configured");
    process.exit(1);
  }

  console.log("News Room: collecting from RSS feeds...");

  // Fetch all feeds in parallel
  const feedResults = await Promise.all(FEEDS.map(fetchFeed));
  const allItems = feedResults.flat();
  console.log(`Fetched ${allItems.length} total items`);

  // Deduplicate against existing items
  const newItems: RawItem[] = [];
  for (const item of allItems) {
    if (!(await isAlreadyStored(item.title))) {
      newItems.push(item);
    }
  }
  console.log(`${newItems.length} new items after dedup`);

  if (newItems.length === 0) {
    console.log("No new items. Done.");
    return;
  }

  // Classify in batches of 5 for reliable Haiku parsing
  const classified: ClassifiedItem[] = [];
  for (let i = 0; i < newItems.length; i += 5) {
    const batch = newItems.slice(i, i + 5);
    const results = await classifyBatch(batch);

    // Merge source info back
    for (let j = 0; j < results.length; j++) {
      if (!results[j].title && batch[j]) {
        results[j].title = batch[j].title;
      }
    }
    classified.push(...results);
  }

  console.log(`Classified ${classified.length} items`);

  // Store in Supabase
  let breakingAlerts: ClassifiedItem[] = [];

  for (let i = 0; i < classified.length; i++) {
    const item = classified[i];
    const raw = newItems[i];
    if (!item || !item.title) continue;

    await supabase.from("news_items").insert({
      title: item.title,
      summary: item.summary,
      category: item.category,
      importance: item.importance,
      source_url: raw?.link || "",
      source_name: raw?.sourceName || "",
    });

    // Track breaking news
    if (item.importance >= 8) {
      breakingAlerts.push(item);
    }
  }

  console.log(`Stored ${classified.length} items`);

  // Send breaking alerts immediately
  for (const alert of breakingAlerts) {
    const msg =
      `*[News Room] Breaking*\n\n` +
      `*${alert.title}*\n` +
      `${alert.summary}\n\n` +
      `Category: ${alert.category.replace("_", " ")}`;
    await sendTelegram(msg, { parseMode: "Markdown" });
    console.log(`Breaking alert sent: ${alert.title}`);
  }

  console.log("News collection complete.");
}

main();
