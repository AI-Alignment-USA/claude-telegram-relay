/**
 * COO Briefing Worker
 *
 * Morning briefing (9am PT): weather, calendar, Thomas, goals, metrics, quote
 * EOD summary (8pm PT): tasks completed, costs, pending approvals, tomorrow preview
 *
 * Uses the COO agent (Tamille) to synthesize the briefing.
 * Run: bun run src/workers/coo-briefing.ts [morning|eod]
 */

import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../utils/telegram.ts";
import { formatCostReport } from "../utils/cost.ts";
import {
  getTodayEvents,
  getUpcomingEvents,
  formatEvents,
  isConfigured as calendarConfigured,
} from "../utils/calendar.ts";
import { guardTiming } from "../utils/timing-guard.ts";
import {
  isConfigured as gmailConfigured,
  searchEmails,
  formatEmailList,
} from "../utils/gmail.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const LAT = 37.3688;
const LON = -122.0363;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ============================================================
// DATA FETCHERS
// ============================================================

async function getWeather(): Promise<string> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&current=temperature_2m,apparent_temperature,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const c = data.current;
    const d = data.daily;
    const temp = Math.round(c.temperature_2m);
    const high = Math.round(d.temperature_2m_max[0]);
    const low = Math.round(d.temperature_2m_min[0]);
    const rain = d.precipitation_probability_max[0];
    const cond = weatherCode(c.weather_code);
    let w = `${cond}, ${temp}F (High ${high}F / Low ${low}F)`;
    if (rain > 0) w += ` | ${rain}% rain`;
    return w;
  } catch {
    return "Weather unavailable";
  }
}

function weatherCode(code: number): string {
  if (code <= 1) return "Clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code >= 45 && code <= 48) return "Foggy";
  if (code >= 51 && code <= 65) return "Rainy";
  if (code >= 71 && code <= 75) return "Snow";
  if (code >= 80) return "Showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

function getThomasSchedule(): string {
  const now = new Date();
  const pacific = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const day = pacific.getDay();

  const schedules: Record<number, string> = {
    1: "Pick up from Tulip Kids 5-6pm",
    2: "Pick up from Tulip 3:15pm, Kumon reading, 5:10pm swim",
    3: "Joshua picks up from Tulip at 4pm, drops off at 7pm",
    4: "Pick up from Tulip 3:15pm, Kumon reading, 5:10pm swim",
    5: "Pick up from Tulip Kids 5-6pm",
    0: "Weekend",
    6: "Weekend",
  };

  let schedule = schedules[day] || "No schedule";

  // Check custody weekends
  if (day === 0 || day === 6) {
    const date = pacific.getDate();
    const month = pacific.getMonth();
    const year = pacific.getFullYear();
    const firstOfMonth = new Date(year, month, 1);
    const firstSat = ((6 - firstOfMonth.getDay() + 7) % 7) + 1;
    const satDate = day === 6 ? date : date - 1;
    const weekendNum = Math.floor((satDate - firstSat) / 7) + 1;
    if (satDate >= firstSat && (weekendNum === 1 || weekendNum === 3 || (weekendNum === 5 && month % 2 === 0))) {
      schedule += " (Thomas with Joshua)";
    }
  }

  return schedule;
}

async function getActiveGoals(): Promise<string> {
  if (!supabase) return "Supabase not configured";
  try {
    const { data } = await supabase.rpc("get_active_goals");
    if (!data || data.length === 0) return "No active goals";
    return data
      .slice(0, 5)
      .map((g: any) => `- ${g.content}`)
      .join("\n");
  } catch {
    return "Goals unavailable";
  }
}

async function getPendingApprovals(): Promise<string> {
  if (!supabase) return "0";
  try {
    const { data } = await supabase.rpc("get_pending_approvals");
    if (!data || data.length === 0) return "None";
    return data
      .map((a: any) => `- [${a.agent_name}] ${a.title}`)
      .join("\n");
  } catch {
    return "Check failed";
  }
}

async function getTodayCosts(): Promise<string> {
  if (!supabase) return "Cost tracking not configured";
  try {
    const { data } = await supabase.rpc("get_daily_costs");
    return formatCostReport(data || []);
  } catch {
    return "Costs unavailable";
  }
}

async function getQuarantinedAgents(): Promise<string> {
  if (!supabase) return "";
  try {
    const { data } = await supabase
      .from("agents")
      .select("id, name, quarantine_reason")
      .eq("quarantined", true);

    if (!data || data.length === 0) return "";
    return data
      .map((a: any) => `- ${a.name}: ${(a.quarantine_reason || "Security maintenance").substring(0, 150)}`)
      .join("\n");
  } catch {
    return "";
  }
}

async function getTasksSummary(period: string): Promise<string> {
  if (!supabase) return "No data";
  try {
    const since = period === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from("tasks")
      .select("agent_id, status, title")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(15);

    if (!data || data.length === 0) return "No tasks recorded";

    const completed = data.filter((t: any) => t.status === "completed");
    const active = data.filter((t: any) =>
      ["pending", "in_progress", "awaiting_coo", "awaiting_approval"].includes(t.status)
    );

    const lines: string[] = [];
    if (completed.length > 0) {
      lines.push(`Completed (${completed.length}):`);
      completed.slice(0, 5).forEach((t: any) => lines.push(`  - [${t.agent_id}] ${t.title}`));
    }
    if (active.length > 0) {
      lines.push(`Active (${active.length}):`);
      active.forEach((t: any) => lines.push(`  - [${t.agent_id}] ${t.title} (${t.status})`));
    }
    return lines.join("\n");
  } catch {
    return "Task summary unavailable";
  }
}

// ============================================================
// MOTIVATIONAL QUOTES
// ============================================================

function getQuote(): string {
  const quotes = [
    "Small steps every day build empires.",
    "You are building something that matters.",
    "Today's effort is tomorrow's evidence.",
    "Progress, not perfection.",
    "Your consistency is your superpower.",
    "Ship it. Learn. Iterate.",
    "Done is better than perfect.",
    "Clarity comes from action, not thought.",
    "You are the CEO. Act like it.",
    "Protect your energy like it's revenue.",
    "Make today count.",
    "One step closer than yesterday.",
    "Trust the process. The results are coming.",
    "Focus on the next right thing.",
    "Start before you're ready.",
  ];
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return quotes[dayOfYear % quotes.length];
}

// ============================================================
// BRIEFINGS
// ============================================================

async function morningBriefing(): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
  const dayName = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "America/Los_Angeles",
  });

  const [weather, goals, approvals, calendarEvents, quarantined, recentEmails] = await Promise.all([
    getWeather(),
    getActiveGoals(),
    getPendingApprovals(),
    calendarConfigured() ? getTodayEvents() : Promise.resolve(null),
    getQuarantinedAgents(),
    gmailConfigured()
      ? searchEmails("is:unread -category:promotions -category:social newer_than:1d", 10)
      : Promise.resolve(null),
  ]);
  const thomas = getThomasSchedule();
  const quote = getQuote();

  const sections = [
    `*Good morning, Crevita!*`,
    dateStr,
    ``,
    `*Sunnyvale Weather*`,
    weather,
  ];

  // Calendar events (Google Calendar API)
  if (calendarEvents !== null) {
    sections.push(``, `*Today's Calendar*`, formatEvents(calendarEvents));
  }

  sections.push(
    ``,
    `*Thomas (${dayName})*`,
    thomas,
    ``,
    `*Active Goals*`,
    goals,
  );

  if (quarantined) {
    sections.push(``, `*Quarantined Agents*`, quarantined);
  }

  // Gmail inbox (crevita.moody@gmail.com)
  if (recentEmails !== null && recentEmails.length > 0) {
    sections.push(``, `*Inbox (${recentEmails.length} unread)*`, formatEmailList(recentEmails));
  } else if (recentEmails !== null) {
    sections.push(``, `*Inbox*`, `No unread emails in the last 24 hours.`);
  }

  if (approvals !== "None") {
    sections.push(``, `*Pending Approvals*`, approvals);
  }

  sections.push(``, `---`, `_"${quote}"_`);

  await sendTelegram(sections.join("\n"), { parseMode: "Markdown" });
}

async function eodSummary(): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const [tasks, costs, approvals, eodQuarantined] = await Promise.all([
    getTasksSummary("today"),
    getTodayCosts(),
    getPendingApprovals(),
    getQuarantinedAgents(),
  ]);

  const sections = [
    `*End of Day Summary*`,
    dateStr,
    ``,
    `*Today's Tasks*`,
    tasks,
    ``,
    `*Today's Costs*`,
    costs,
  ];

  if (eodQuarantined) {
    sections.push(``, `*Quarantined Agents*`, eodQuarantined);
  }

  if (approvals !== "None") {
    sections.push(``, `*Pending Approvals*`, approvals);
  }

  // Tomorrow preview
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDay = new Date(
    tomorrow.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  ).getDay();
  const tomorrowSchedules: Record<number, string> = {
    1: "Thomas: Tulip Kids pickup 5-6pm",
    2: "Thomas: Tulip 3:15pm, Kumon, 5:10pm swim",
    3: "Thomas: Joshua pickup 4pm, dropoff 7pm",
    4: "Thomas: Tulip 3:15pm, Kumon, 5:10pm swim",
    5: "Thomas: Tulip Kids pickup 5-6pm",
    0: "Weekend",
    6: "Weekend",
  };
  sections.push(``, `*Tomorrow Preview*`, tomorrowSchedules[tomorrowDay] || "No schedule");

  // Tomorrow's calendar events
  if (calendarConfigured()) {
    const tomorrowStart = new Date(
      tomorrow.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    );
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const upcoming = await getUpcomingEvents(2);
    if (upcoming && upcoming.length > 0) {
      const tomorrowDateStr = tomorrow.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "America/Los_Angeles",
      });
      const tomorrowEvents = upcoming.filter((e) => {
        const eventDate = new Date(e.startTime).toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          timeZone: "America/Los_Angeles",
        });
        return eventDate === tomorrowDateStr;
      });
      if (tomorrowEvents.length > 0) {
        sections.push(formatEvents(tomorrowEvents));
      }
    }
  }

  sections.push(``, `---`, `_Good night, Crevita._`);

  await sendTelegram(sections.join("\n"), { parseMode: "Markdown" });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_USER_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const mode = process.argv[2] || "morning";

  if (mode === "eod") {
    guardTiming("coo-eod", { earliest: "19:45", latest: "20:15" });
    console.log("Building EOD summary...");
    await eodSummary();
    console.log("EOD summary sent.");
  } else {
    guardTiming("coo-morning", { earliest: "4:45", latest: "5:30" });
    console.log("Building morning briefing...");
    await morningBriefing();
    console.log("Morning briefing sent.");
  }
}

main();
