/**
 * Memory Flush Worker
 *
 * Runs nightly at 11pm ET. Reads today's conversation history from Supabase,
 * asks Claude to extract durable facts, then writes them to the appropriate
 * memory files and commits/pushes.
 *
 * Schedule: 0 23 * * * (daily 11pm ET)
 * Run: bun run src/workers/memory-flush.ts
 */

import { spawnSync } from "bun";
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { sendTelegram } from "../utils/telegram.ts";

const ROOT = join(import.meta.dir, "../..");
const MEMORY_DIR = join(ROOT, "memory");
const PEOPLE_DIR = join(MEMORY_DIR, "people");
const PROJECTS_DIR = join(MEMORY_DIR, "projects");
const MEMORY_INDEX = join(ROOT, "MEMORY.md");
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ============================================================
// HELPERS
// ============================================================

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDirs(): void {
  for (const dir of [MEMORY_DIR, PEOPLE_DIR, PROJECTS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ============================================================
// FETCH TODAY'S CONVERSATIONS
// ============================================================

async function fetchTodayMessages(): Promise<string> {
  if (!supabase) {
    console.log("[memory-flush] No Supabase configured, skipping message fetch");
    return "";
  }

  const startOfDay = `${today()}T00:00:00.000Z`;
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .gte("created_at", startOfDay)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[memory-flush] Supabase error:", error.message);
    return "";
  }

  if (!data || data.length === 0) {
    console.log("[memory-flush] No messages found for today");
    return "";
  }

  console.log(`[memory-flush] Found ${data.length} messages from today`);

  return data
    .map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`)
    .join("\n\n");
}

// ============================================================
// ASK CLAUDE TO EXTRACT FACTS
// ============================================================

interface ExtractedFacts {
  daily_events: string[];
  people: { name: string; facts: string[] }[];
  projects: { name: string; facts: string[] }[];
  long_term: string[];
}

function extractFacts(conversations: string, existingMemory: string): ExtractedFacts {
  const prompt = `You are a memory extraction assistant. Analyze the following conversation log from today and extract DURABLE facts worth remembering long-term.

EXISTING MEMORY (do not duplicate these):
${existingMemory}

TODAY'S CONVERSATIONS:
${conversations}

Extract facts into these categories. Only include genuinely new, durable information -- not ephemeral chit-chat or things already in existing memory. Use double hyphens (--) instead of em dashes.

Respond in EXACTLY this JSON format (no markdown fencing, no extra text):
{
  "daily_events": ["event 1", "event 2"],
  "people": [{"name": "PersonName", "facts": ["fact about them"]}],
  "projects": [{"name": "ProjectName", "facts": ["fact about project"]}],
  "long_term": ["durable fact for MEMORY.md"]
}

If nothing new is worth saving, return empty arrays for all fields.`;

  const proc = spawnSync(
    [CLAUDE_PATH, "-p", prompt, "--model", "haiku", "--output-format", "text"],
    { timeout: 120_000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  );

  const output = new TextDecoder().decode(proc.stdout).trim();

  if (!output) {
    console.log("[memory-flush] Claude returned empty response");
    return { daily_events: [], people: [], projects: [], long_term: [] };
  }

  try {
    // Strip markdown fencing if Claude adds it despite instructions
    const cleaned = output.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "");
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("[memory-flush] Failed to parse Claude response:", output.slice(0, 200));
    return { daily_events: [], people: [], projects: [], long_term: [] };
  }
}

// ============================================================
// WRITE MEMORY FILES
// ============================================================

function writeDailyLog(events: string[]): boolean {
  if (events.length === 0) return false;

  const logPath = join(MEMORY_DIR, `${today()}.md`);
  const existing = readFileSafe(logPath);

  if (existing) {
    // Append to existing daily log
    const newEntries = events.map((e) => `- ${e}`).join("\n");
    appendFileSync(logPath, `\n${newEntries}\n`);
  } else {
    const content = `# ${today()} -- Daily Log\n\n## What Happened\n\n${events.map((e) => `- ${e}`).join("\n")}\n`;
    writeFileSync(logPath, content);
  }

  console.log(`[memory-flush] Wrote ${events.length} events to daily log`);
  return true;
}

function writePeopleFiles(people: { name: string; facts: string[] }[]): boolean {
  if (people.length === 0) return false;

  let wrote = false;
  for (const person of people) {
    const slug = slugify(person.name);
    const filePath = join(PEOPLE_DIR, `${slug}.md`);
    const existing = readFileSafe(filePath);

    if (existing) {
      const newFacts = person.facts.map((f) => `- ${f}`).join("\n");
      appendFileSync(filePath, `\n${newFacts}\n`);
    } else {
      const content = `# ${person.name}\n\n${person.facts.map((f) => `- ${f}`).join("\n")}\n`;
      writeFileSync(filePath, content);
    }

    console.log(`[memory-flush] Updated people/${slug}.md`);
    wrote = true;
  }
  return wrote;
}

function writeProjectFiles(projects: { name: string; facts: string[] }[]): boolean {
  if (projects.length === 0) return false;

  let wrote = false;
  for (const project of projects) {
    const slug = slugify(project.name);
    const filePath = join(PROJECTS_DIR, `${slug}.md`);
    const existing = readFileSafe(filePath);

    if (existing) {
      const newFacts = project.facts.map((f) => `- ${f}`).join("\n");
      appendFileSync(filePath, `\n${newFacts}\n`);
    } else {
      const content = `# ${project.name}\n\n${project.facts.map((f) => `- ${f}`).join("\n")}\n`;
      writeFileSync(filePath, content);
    }

    console.log(`[memory-flush] Updated projects/${slug}.md`);
    wrote = true;
  }
  return wrote;
}

function updateMemoryIndex(longTermFacts: string[]): boolean {
  if (longTermFacts.length === 0) return false;

  const existing = readFileSafe(MEMORY_INDEX);
  if (!existing) {
    console.error("[memory-flush] MEMORY.md not found, skipping long-term facts");
    return false;
  }

  // Append new long-term facts before the Daily Logs section
  const marker = "## Daily Logs";
  const markerIdx = existing.indexOf(marker);

  if (markerIdx === -1) {
    // No Daily Logs section, just append at the end
    const newFacts = longTermFacts.map((f) => `- ${f}`).join("\n");
    appendFileSync(MEMORY_INDEX, `\n## Extracted Facts (${today()})\n\n${newFacts}\n`);
  } else {
    // Insert before Daily Logs
    const before = existing.slice(0, markerIdx);
    const after = existing.slice(markerIdx);
    const newFacts = longTermFacts.map((f) => `- ${f}`).join("\n");
    const updated = `${before}## Extracted Facts (${today()})\n\n${newFacts}\n\n${after}`;
    writeFileSync(MEMORY_INDEX, updated);
  }

  console.log(`[memory-flush] Added ${longTermFacts.length} facts to MEMORY.md`);
  return true;
}

// ============================================================
// GIT COMMIT AND PUSH
// ============================================================

function gitCommitAndPush(): boolean {
  try {
    const addResult = spawnSync(["git", "add", "MEMORY.md", "memory/"], {
      cwd: ROOT,
      timeout: 30_000,
      windowsHide: true,
    });

    if (addResult.exitCode !== 0) {
      console.error("[memory-flush] git add failed");
      return false;
    }

    // Check if there are staged changes
    const diffResult = spawnSync(["git", "diff", "--cached", "--quiet"], {
      cwd: ROOT,
      timeout: 15_000,
      windowsHide: true,
    });

    if (diffResult.exitCode === 0) {
      console.log("[memory-flush] No changes to commit");
      return false;
    }

    const commitResult = spawnSync(
      ["git", "commit", "-m", `memory-flush: ${today()} nightly knowledge extraction`],
      { cwd: ROOT, timeout: 30_000, windowsHide: true }
    );

    if (commitResult.exitCode !== 0) {
      const stderr = new TextDecoder().decode(commitResult.stderr);
      console.error("[memory-flush] git commit failed:", stderr);
      return false;
    }

    const pushResult = spawnSync(["git", "push"], {
      cwd: ROOT,
      timeout: 60_000,
      windowsHide: true,
    });

    if (pushResult.exitCode !== 0) {
      const stderr = new TextDecoder().decode(pushResult.stderr);
      console.error("[memory-flush] git push failed:", stderr);
      return false;
    }

    console.log("[memory-flush] Committed and pushed memory updates");
    return true;
  } catch (e) {
    console.error("[memory-flush] Git error:", e);
    return false;
  }
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  console.log(`[memory-flush] Starting nightly memory flush for ${today()}`);

  ensureDirs();

  // 1. Read existing memory context
  const existingMemory = readFileSafe(MEMORY_INDEX);
  const existingDailyLog = readFileSafe(join(MEMORY_DIR, `${today()}.md`));
  const fullContext = `${existingMemory}\n\n--- TODAY'S LOG SO FAR ---\n${existingDailyLog}`;

  // 2. Fetch today's conversations from Supabase
  const conversations = await fetchTodayMessages();

  if (!conversations) {
    console.log("[memory-flush] No conversations to process, exiting");
    await sendTelegram("Memory flush: no conversations today, nothing to extract.");
    return;
  }

  // 3. Ask Claude to extract durable facts
  const facts = extractFacts(conversations, fullContext);

  const totalFacts =
    facts.daily_events.length +
    facts.people.reduce((n, p) => n + p.facts.length, 0) +
    facts.projects.reduce((n, p) => n + p.facts.length, 0) +
    facts.long_term.length;

  if (totalFacts === 0) {
    console.log("[memory-flush] No new facts extracted");
    await sendTelegram("Memory flush: reviewed today's conversations, nothing new to save.");
    return;
  }

  // 4. Write to appropriate memory files
  const wroteDaily = writeDailyLog(facts.daily_events);
  const wrotePeople = writePeopleFiles(facts.people);
  const wroteProjects = writeProjectFiles(facts.projects);
  const wroteIndex = updateMemoryIndex(facts.long_term);

  // 5. Git commit and push
  const pushed = gitCommitAndPush();

  // 6. Report
  const summary = [
    `Memory flush complete for ${today()}:`,
    facts.daily_events.length > 0 ? `  ${facts.daily_events.length} daily events` : null,
    facts.people.length > 0 ? `  ${facts.people.length} people updated` : null,
    facts.projects.length > 0 ? `  ${facts.projects.length} projects updated` : null,
    facts.long_term.length > 0 ? `  ${facts.long_term.length} long-term facts` : null,
    pushed ? "  Committed and pushed to git." : "  Git push skipped or failed.",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`[memory-flush] ${summary}`);
  await sendTelegram(summary);
}

main().catch((e) => {
  console.error("[memory-flush] Fatal error:", e);
  process.exit(1);
});
