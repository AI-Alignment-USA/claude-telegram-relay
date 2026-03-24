/**
 * Twitter Nudge Worker
 *
 * Runs at 9 AM PT. Checks if today's tweet drafts were sent but not
 * responded to. Sends one follow-up nudge via Telegram. If no response
 * by 11 AM, the drafts simply expire (implicit skip).
 *
 * Coordinates with twitter-drafts via data/twitter-draft-status.json.
 *
 * Schedule: 0 9 * * * (9 AM PT)
 * Run: bun run src/workers/twitter-nudge.ts
 */

import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { sendTelegram } from "../utils/telegram.ts";
import { guardTiming } from "../utils/timing-guard.ts";

const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));
const LABEL = "twitter-nudge";
const FLAG_FILE = join(PROJECT_ROOT, "data", "twitter-draft-status.json");

interface DraftStatus {
  date: string;
  drafted: boolean;
  responded: boolean;
  status: "pending" | "nudged" | "approved" | "skipped";
}

function getTodayDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function main(): Promise<void> {
  guardTiming(LABEL, { earliest: "8:45", latest: "9:30" });

  const today = getTodayDateStr();

  // Read flag file
  let status: DraftStatus | null = null;
  try {
    const raw = await readFile(FLAG_FILE, "utf-8");
    status = JSON.parse(raw);
  } catch {
    console.log(`[${LABEL}] No flag file found. Nothing to nudge.`);
    process.exit(0);
  }

  // Only nudge if today's drafts are pending (not yet responded, not already nudged)
  if (!status || status.date !== today) {
    console.log(`[${LABEL}] No drafts for today. Exiting.`);
    process.exit(0);
  }

  if (status.status !== "pending") {
    console.log(`[${LABEL}] Drafts status is "${status.status}", not pending. Exiting.`);
    process.exit(0);
  }

  if (status.responded) {
    console.log(`[${LABEL}] Already responded to. Exiting.`);
    process.exit(0);
  }

  // Send one nudge
  console.log(`[${LABEL}] Drafts pending since this morning. Sending nudge...`);

  const result = await sendTelegram(
    "Hey, you have X post drafts waiting from this morning. Want to approve one, or should I skip today?"
  );

  if (result.ok) {
    // Update flag to "nudged" so we don't nudge again
    status.status = "nudged";
    await writeFile(FLAG_FILE, JSON.stringify(status, null, 2), "utf-8");
    console.log(`[${LABEL}] Nudge sent. Status updated to "nudged".`);
  } else {
    console.error(`[${LABEL}] Failed to send nudge.`);
  }
}

main().catch((err) => {
  console.error(`[${LABEL}] Fatal error:`, err);
  process.exit(1);
});
