/**
 * Polymarket Dry Run — Weekly Check-In Worker
 *
 * Every Sunday at 6pm PT: reads the tracker file, web-searches for
 * latest news on each tracked market, fetches current Polymarket prices,
 * updates the weekly check-in section, and sends a Telegram summary.
 *
 * Agent: News Room (Tier 1, autonomous)
 * Run: bun run src/workers/polymarket-checkin.ts
 */

import { spawnSync } from "bun";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { sendTelegram } from "../utils/telegram.ts";
import { guardTiming } from "../utils/timing-guard.ts";

const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));
const TRACKER_PATH = join(PROJECT_ROOT, "polymarket-dry-run.md");
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// Markets we track (must match polymarket-dry-run.md)
const MARKETS = [
  {
    id: "midterms-dems-sweep",
    label: "Midterms: Democrats Sweep",
    query: "2026 midterm elections polls Democrats House Senate latest",
    polymarketUrl: "https://polymarket.com/event/balance-of-power-2026-midterms",
    prediction: "Democrats Sweep (YES)",
  },
  {
    id: "fed-rate-cuts",
    label: "Fed Rate Cuts 2026: 1 cut",
    query: "Federal Reserve rate cuts 2026 FOMC inflation outlook latest",
    polymarketUrl: "https://polymarket.com/event/how-many-fed-rate-cuts-in-2026",
    prediction: "1 cut (YES)",
  },
  {
    id: "ai-model-march",
    label: "AI Model: Anthropic",
    query: "best AI model chatbot arena leaderboard Anthropic Claude rankings latest",
    polymarketUrl: "https://polymarket.com/event/which-company-has-the-best-ai-model-end-of-march-751",
    prediction: "Anthropic (YES)",
    expiresAfter: "2026-03-31",
  },
];

interface MarketUpdate {
  label: string;
  currentPrice: string;
  previousPrice: string;
  change: string;
  newsHighlights: string;
  prediction: string;
}

/**
 * Read the current tracker file
 */
async function readTracker(): Promise<string> {
  try {
    return await readFile(TRACKER_PATH, "utf-8");
  } catch {
    throw new Error(`Tracker file not found at ${TRACKER_PATH}`);
  }
}

/**
 * Extract the most recent prices from the tracker markdown
 */
function extractLastPrices(tracker: string): Record<string, string> {
  const prices: Record<string, string> = {};

  // Look for the last filled-in weekly check-in table row for each market
  const midtermsMatch = tracker.match(/Midterms: Dems Sweep\s*\|\s*[\d.]+c\s*\|\s*([\d.]+c)/);
  const fedMatch = tracker.match(/Fed: 1 cut\s*\|\s*[\d.]+c\s*\|\s*([\d.]+c)/);
  const aiMatch = tracker.match(/AI Model: Anthropic\s*\|\s*[\d.]+c\s*\|\s*([\d.]+c)/);

  // Fall back to baseline prices if no updates yet
  prices["midterms-dems-sweep"] = midtermsMatch?.[1] || "50c";
  prices["fed-rate-cuts"] = fedMatch?.[1] || "35c";
  prices["ai-model-march"] = aiMatch?.[1] || "93.9c";

  return prices;
}

/**
 * Use Claude to web-search for latest news on a market topic
 */
function searchMarketNews(query: string): string {
  try {
    const prompt =
      `Search the web for the latest news on: ${query}\n\n` +
      `Return a concise 2-3 bullet summary of the most relevant recent developments. ` +
      `Focus on facts that could move prediction market odds. ` +
      `Include dates. NEVER use em dashes.`;

    const proc = spawnSync(
      [CLAUDE_PATH, "-p", prompt, "--model", "sonnet", "--output-format", "text"],
      { timeout: 45000 }
    );

    const output = new TextDecoder().decode(proc.stdout).trim();
    return output || "No news retrieved.";
  } catch {
    return "News search failed.";
  }
}

/**
 * Use Claude to fetch current Polymarket prices for a market
 */
function fetchPolymarketPrice(url: string, label: string): string {
  try {
    const prompt =
      `Fetch this URL and extract the current market prices: ${url}\n\n` +
      `Return ONLY the outcome names and their current percentage prices, ` +
      `formatted like: "Democrats Sweep: 52c, R Senate D House: 33c" etc. ` +
      `Be concise. Just the prices.`;

    const proc = spawnSync(
      [CLAUDE_PATH, "-p", prompt, "--model", "haiku", "--output-format", "text"],
      { timeout: 30000 }
    );

    const output = new TextDecoder().decode(proc.stdout).trim();
    return output || "Price fetch failed.";
  } catch {
    return "Price fetch failed.";
  }
}

/**
 * Build the weekly check-in entry and append it to the tracker
 */
async function updateTracker(
  tracker: string,
  updates: MarketUpdate[],
  weekNumber: number,
  dateStr: string
): Promise<string> {
  const entry = [
    `### Week ${weekNumber}: ${dateStr}`,
    ``,
    `| Market | Previous Price | Current Price | Change | Notes |`,
    `|--------|---------------|---------------|--------|-------|`,
  ];

  for (const u of updates) {
    entry.push(
      `| ${u.label} | ${u.previousPrice} | ${u.currentPrice} | ${u.change} | ${u.newsHighlights.substring(0, 80)} |`
    );
  }

  entry.push(``);
  entry.push(`**Prediction accuracy:** Tracking`);
  entry.push(`**Key developments:**`);
  for (const u of updates) {
    entry.push(`- ${u.label}: ${u.newsHighlights.substring(0, 200)}`);
  }
  entry.push(``);

  const newEntry = entry.join("\n");

  // Find the right place to insert: look for the first unfilled week template
  // (a week entry with " -- " placeholders) or append before the footer
  const unfilledWeekPattern = /### Week \d+:.*?\n\n\|[^\n]*\n\|[^\n]*\n(\|[^\n]*--[^\n]*\n)+/;
  const unfilledMatch = tracker.match(unfilledWeekPattern);

  if (unfilledMatch) {
    // Replace the first unfilled week template
    return tracker.replace(unfilledMatch[0], newEntry + "\n");
  }

  // Otherwise, insert before the footer disclaimer
  const footerMarker = "*This tracker is for educational";
  const footerIdx = tracker.lastIndexOf(footerMarker);

  if (footerIdx > 0) {
    return (
      tracker.substring(0, footerIdx) +
      newEntry +
      "\n---\n\n" +
      tracker.substring(footerIdx)
    );
  }

  // Fallback: append to end
  return tracker + "\n\n" + newEntry;
}

/**
 * Build and send the Telegram summary
 */
async function sendSummary(updates: MarketUpdate[], dateStr: string): Promise<void> {
  const sections = [
    `*[News Room] Polymarket Weekly Check-In*`,
    dateStr,
    ``,
  ];

  for (const u of updates) {
    const arrow = u.change.startsWith("+") ? "up" : u.change.startsWith("-") ? "down" : "flat";
    sections.push(
      `*${u.label}*`,
      `  Price: ${u.currentPrice} (was ${u.previousPrice}, ${arrow} ${u.change})`,
      `  My prediction: ${u.prediction}`,
      `  News: ${u.newsHighlights.substring(0, 300)}`,
      ``
    );
  }

  sections.push(
    `*Should predictions be revised?*`
  );

  // Use Claude to assess whether predictions need updating
  const assessPrompt =
    `You are a prediction market analyst. Based on these market updates, briefly assess ` +
    `whether each prediction should be revised or held. Be concise (1-2 sentences each). ` +
    `NEVER use em dashes.\n\n` +
    updates
      .map(
        (u) =>
          `${u.label}: prediction=${u.prediction}, price moved from ${u.previousPrice} to ${u.currentPrice}. ` +
          `News: ${u.newsHighlights}`
      )
      .join("\n\n");

  try {
    const proc = spawnSync(
      [CLAUDE_PATH, "-p", assessPrompt, "--model", "sonnet", "--output-format", "text"],
      { timeout: 30000 }
    );

    const assessment = new TextDecoder().decode(proc.stdout).trim();
    if (assessment) sections.push(assessment);
  } catch {
    sections.push("(Assessment generation failed)");
  }

  const message = sections.join("\n");

  // Split if too long for Telegram (4096 char limit)
  if (message.length > 4000) {
    const mid = message.lastIndexOf("\n\n", 3800);
    await sendTelegram(message.substring(0, mid), { parseMode: "Markdown" });
    await sendTelegram(message.substring(mid), { parseMode: "Markdown" });
  } else {
    await sendTelegram(message, { parseMode: "Markdown" });
  }
}

/**
 * Calculate price change string
 */
function calcChange(prev: string, curr: string): string {
  const prevNum = parseFloat(prev.replace("c", ""));
  const currNum = parseFloat(curr.replace("c", ""));

  if (isNaN(prevNum) || isNaN(currNum)) return "N/A";

  const diff = currNum - prevNum;
  if (diff === 0) return "flat";
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}c`;
}

/**
 * Determine the week number based on tracker start date (March 18, 2026)
 */
function getWeekNumber(): number {
  const start = new Date("2026-03-18T00:00:00-07:00");
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(2, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  guardTiming("polymarket-checkin", { days: [0], earliest: "17:45", latest: "18:15" });

  console.log("Starting Polymarket weekly check-in...");

  // 1. Read the tracker
  let tracker = await readTracker();
  const lastPrices = extractLastPrices(tracker);

  // 2. Check which markets are still active
  const activeMarkets = MARKETS.filter((m) => {
    if (!m.expiresAfter) return true;
    return new Date() < new Date(m.expiresAfter);
  });

  if (activeMarkets.length === 0) {
    console.log("No active markets to track.");
    return;
  }

  // 3. For each market: search news + fetch prices
  const updates: MarketUpdate[] = [];

  for (const market of activeMarkets) {
    console.log(`Researching: ${market.label}...`);

    const news = searchMarketNews(market.query);
    const priceData = fetchPolymarketPrice(market.polymarketUrl, market.label);

    // Extract the primary price from the price data
    // Try to parse the first number from the response as the current price
    const priceMatch = priceData.match(/(\d+\.?\d*)\s*[c%]/);
    const currentPrice = priceMatch ? `${priceMatch[1]}c` : "??c";
    const previousPrice = lastPrices[market.id] || "??c";

    updates.push({
      label: market.label,
      currentPrice,
      previousPrice,
      change: calcChange(previousPrice, currentPrice),
      newsHighlights: news.replace(/\n/g, " ").substring(0, 500),
      prediction: market.prediction,
    });
  }

  // 4. Update the tracker file
  const weekNum = getWeekNumber();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });

  tracker = await updateTracker(tracker, updates, weekNum, dateStr);
  await writeFile(TRACKER_PATH, tracker, "utf-8");
  console.log("Tracker file updated.");

  // 5. Send Telegram summary
  await sendSummary(updates, dateStr);
  console.log("Telegram summary sent.");

  // 6. Git commit the updated tracker
  try {
    const gitAdd = spawnSync(["git", "add", "polymarket-dry-run.md"], {
      cwd: PROJECT_ROOT,
      timeout: 10000,
    });
    const gitCommit = spawnSync(
      [
        "git",
        "commit",
        "-m",
        `Update Polymarket tracker: week ${weekNum} check-in (${dateStr})`,
      ],
      { cwd: PROJECT_ROOT, timeout: 10000 }
    );
    const gitPush = spawnSync(["git", "push"], {
      cwd: PROJECT_ROOT,
      timeout: 30000,
    });

    if (gitPush.exitCode === 0) {
      console.log("Tracker committed and pushed.");
    } else {
      console.log("Git push failed, tracker saved locally.");
    }
  } catch {
    console.log("Git operations failed, tracker saved locally.");
  }
}

main();
