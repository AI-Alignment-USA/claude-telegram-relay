/**
 * Education Digest Worker
 *
 * Weekly digest on Sundays at 7pm PT covering Thomas's education week.
 * READ-ONLY: reports observations, never contacts anyone externally.
 *
 * Run: bun run src/workers/education-digest.ts
 */

import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../utils/telegram.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

async function getWeekContext(): Promise<string> {
  if (!supabase) return "";

  try {
    // Search memory for Thomas-related entries
    const { data: memories } = await supabase
      .from("memory")
      .select("content, type, created_at")
      .or("content.ilike.%thomas%,content.ilike.%kumon%,content.ilike.%school%,content.ilike.%reading%,content.ilike.%swim%")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    // Search messages for Thomas-related conversations
    const { data: messages } = await supabase
      .from("messages")
      .select("content, role, created_at")
      .or("content.ilike.%thomas%,content.ilike.%kumon%,content.ilike.%school%,content.ilike.%ponderosa%,content.ilike.%tulip%")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    const parts: string[] = [];

    if (memories && memories.length > 0) {
      parts.push("Recent memories:");
      memories.forEach((m: any) => parts.push(`  - [${m.type}] ${m.content}`));
    }

    if (messages && messages.length > 0) {
      parts.push("Recent conversations:");
      messages.forEach((m: any) =>
        parts.push(`  - [${m.role}] ${m.content.substring(0, 100)}`)
      );
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}

async function buildDigest(): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const weekContext = await getWeekContext();

  // Build the upcoming week preview
  const nextWeek = [];
  for (let i = 1; i <= 5; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const day = new Date(
      d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    ).getDay();
    const dayName = d.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "America/Los_Angeles",
    });

    const schedules: Record<number, string> = {
      1: "Tulip Kids 5-6pm",
      2: "Tulip 3:15pm, Kumon, swim 5:10pm",
      3: "Joshua pickup 4pm, dropoff 7pm",
      4: "Tulip 3:15pm, Kumon, swim 5:10pm",
      5: "Tulip Kids 5-6pm",
    };

    if (schedules[day]) {
      nextWeek.push(`  ${dayName}: ${schedules[day]}`);
    }
  }

  const sections = [
    `*[Head of Education] Weekly Digest*`,
    `Week ending ${dateStr}`,
    ``,
    `*Thomas's Week*`,
  ];

  if (weekContext) {
    sections.push(weekContext);
  } else {
    sections.push(`No education-related updates recorded this week.`);
  }

  sections.push(
    ``,
    `*Current Focus Areas*`,
    `- Reading: Kumon intervention (Tue/Thu)`,
    `- Swimming: Lessons (Tue/Thu 5:10pm)`,
    `- School: Kindergarten at Ponderosa Elementary`,
    ``,
    `*Next Week Schedule*`,
    ...nextWeek,
    ``,
    `---`,
    `_This is a read-only digest. Reply to discuss or take action._`
  );

  await sendTelegram(sections.join("\n"), { parseMode: "Markdown" });
}

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  console.log("Building education digest...");
  await buildDigest();
  console.log("Education digest sent.");
}

main();
