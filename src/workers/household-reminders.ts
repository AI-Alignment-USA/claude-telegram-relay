/**
 * Household Reminders Worker
 *
 * Daily at 8am PT: bills, maintenance, co-parenting calendar reminders.
 *
 * Run: bun run src/workers/household-reminders.ts
 */

import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../utils/telegram.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

function getTodayReminders(): string[] {
  const now = new Date();
  const pacific = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const day = pacific.getDay();
  const date = pacific.getDate();
  const month = pacific.getMonth();
  const year = pacific.getFullYear();

  const reminders: string[] = [];

  // Co-parenting schedule reminders
  if (day === 3) {
    // Wednesday
    reminders.push("Thomas: Joshua picks up from Tulip at 4pm, drops off at 7pm");
  }

  // Check if tomorrow starts a custody weekend
  const tomorrow = new Date(pacific.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDay = tomorrow.getDay();
  const tomorrowDate = tomorrow.getDate();

  if (tomorrowDay === 6) {
    // Tomorrow is Saturday - check if it's a custody weekend
    const firstOfMonth = new Date(year, month, 1);
    const firstSat = ((6 - firstOfMonth.getDay() + 7) % 7) + 1;
    const weekendNum = Math.floor((tomorrowDate - firstSat) / 7) + 1;

    if (
      tomorrowDate >= firstSat &&
      (weekendNum === 1 || weekendNum === 3 || (weekendNum === 5 && month % 2 === 0))
    ) {
      reminders.push("Reminder: Tomorrow starts Joshua's custody weekend. Pack Thomas's bag tonight.");
    }
  }

  // Monthly reminders based on date
  if (date === 1) {
    reminders.push("First of the month: review recurring bills and subscriptions");
  }
  if (date === 15) {
    reminders.push("Mid-month: check budget vs actual spending");
  }

  // Seasonal reminders
  if (month === 0 && date === 1) reminders.push("Annual: review insurance policies");
  if (month === 3 && date === 1) reminders.push("Spring: schedule HVAC maintenance");
  if (month === 9 && date === 1) reminders.push("Fall: check smoke detectors, replace furnace filter");

  return reminders;
}

async function getMemoryReminders(): Promise<string[]> {
  if (!supabase) return [];

  try {
    // Check for goals with upcoming deadlines
    const { data: goals } = await supabase
      .from("memory")
      .select("content, deadline")
      .eq("type", "goal")
      .not("deadline", "is", null)
      .order("deadline", { ascending: true })
      .limit(5);

    if (!goals || goals.length === 0) return [];

    const now = new Date();
    const reminders: string[] = [];

    for (const goal of goals) {
      const deadline = new Date(goal.deadline);
      const daysUntil = Math.ceil(
        (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntil <= 3 && daysUntil >= 0) {
        reminders.push(`Deadline in ${daysUntil} day(s): ${goal.content}`);
      } else if (daysUntil < 0) {
        reminders.push(`OVERDUE: ${goal.content}`);
      }
    }

    return reminders;
  } catch {
    return [];
  }
}

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const calendarReminders = getTodayReminders();
  const deadlineReminders = await getMemoryReminders();
  const allReminders = [...calendarReminders, ...deadlineReminders];

  if (allReminders.length === 0) {
    console.log("No reminders for today. Skipping.");
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const message = [
    `*[Household] Daily Reminders*`,
    dateStr,
    ``,
    ...allReminders.map((r) => `- ${r}`),
  ].join("\n");

  console.log("Sending household reminders...");
  await sendTelegram(message, { parseMode: "Markdown" });
  console.log("Reminders sent.");
}

main();
