/**
 * Dedup Guard
 *
 * Prevents duplicate report sends within the same calendar day (Pacific Time).
 * Uses a local flag file in the logs/ directory. Each worker writes a dated
 * flag file after successfully running; if the flag already exists, the worker
 * exits silently.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const TZ = "America/Los_Angeles";
const PROJECT_ROOT = join(dirname(dirname(import.meta.dir)));
const FLAGS_DIR = join(PROJECT_ROOT, "logs", "dedup-flags");

function getTodayDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

function getFlagPath(label: string): string {
  return join(FLAGS_DIR, `${label}-${getTodayDateStr()}.flag`);
}

/**
 * Check if this worker already ran today. If so, exit silently.
 * Call this at the top of main(), before doing any work.
 */
export function guardDedup(label: string): void {
  if (!existsSync(FLAGS_DIR)) {
    mkdirSync(FLAGS_DIR, { recursive: true });
  }

  const flagPath = getFlagPath(label);
  if (existsSync(flagPath)) {
    console.log(
      `[${label}] Dedup guard: already ran today (${getTodayDateStr()}). Exiting silently.`
    );
    process.exit(0);
  }
}

/**
 * Mark this worker as having run today. Call after the report is sent.
 */
export function markDedupComplete(label: string): void {
  if (!existsSync(FLAGS_DIR)) {
    mkdirSync(FLAGS_DIR, { recursive: true });
  }

  const flagPath = getFlagPath(label);
  writeFileSync(flagPath, new Date().toISOString(), "utf-8");
  console.log(`[${label}] Dedup flag set for ${getTodayDateStr()}.`);
}
