/**
 * Morning Briefing - Live Data
 *
 * Sends a daily summary at 7am Pacific via Telegram.
 * Data sources:
 *   - Weather: Open-Meteo API (Sunnyvale, CA, Fahrenheit)
 *   - Calendar: Google Calendar API via claude CLI + MCP
 *   - Thomas's schedule: day-of-week logic + custody weekends
 *   - Goals: Supabase memory table
 *   - Motivational quote: curated list
 *
 * Run manually: bun run examples/morning-briefing.ts
 */

import { spawnSync } from "bun";
import {
  getTodayEvents,
  formatEvents,
  isConfigured as calendarConfigured,
} from "../src/utils/calendar.ts";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Sunnyvale, CA coordinates
const LAT = 37.3688;
const LON = -122.0363;

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );
    return response.ok;
  } catch (error) {
    console.error("Telegram error:", error);
    return false;
  }
}

// ============================================================
// WEATHER (Open-Meteo - free, no API key)
// ============================================================

async function getWeather(): Promise<string> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles&forecast_days=1`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const current = data.current;
    const daily = data.daily;

    const temp = Math.round(current.temperature_2m);
    const feelsLike = Math.round(current.apparent_temperature);
    const humidity = current.relative_humidity_2m;
    const wind = Math.round(current.wind_speed_10m);
    const high = Math.round(daily.temperature_2m_max[0]);
    const low = Math.round(daily.temperature_2m_min[0]);
    const rainChance = daily.precipitation_probability_max[0];

    const condition = weatherCodeToText(current.weather_code);
    const icon = weatherCodeToIcon(current.weather_code);

    let weather = `${icon} ${condition}, ${temp}F (feels ${feelsLike}F)`;
    weather += `\n  High ${high}F / Low ${low}F`;
    if (rainChance > 0) weather += ` | ${rainChance}% rain`;
    if (wind > 10) weather += `\n  Wind: ${wind} mph`;

    return weather;
  } catch (e: any) {
    console.error("Weather error:", e.message);
    return "Weather unavailable";
  }
}

function weatherCodeToText(code: number): string {
  const codes: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Icy fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Light showers",
    81: "Showers",
    82: "Heavy showers",
    95: "Thunderstorm",
  };
  return codes[code] || "Unknown";
}

function weatherCodeToIcon(code: number): string {
  if (code === 0 || code === 1) return "☀️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 51 && code <= 65) return "🌧️";
  if (code >= 71 && code <= 75) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

// ============================================================
// GOOGLE CALENDAR (direct API)
// ============================================================

async function getCalendarEvents(): Promise<string> {
  if (!calendarConfigured()) {
    return "Calendar not configured (add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to .env)";
  }
  try {
    const events = await getTodayEvents();
    if (events === null) return "Calendar API error";
    return formatEvents(events);
  } catch (e: any) {
    console.error("Calendar error:", e.message);
    return "Calendar unavailable";
  }
}

// ============================================================
// THOMAS'S SCHEDULE
// ============================================================

function getThomasSchedule(): string {
  const now = new Date();
  const pacific = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const day = pacific.getDay(); // 0=Sun, 1=Mon, ...
  const date = pacific.getDate();
  const month = pacific.getMonth();
  const year = pacific.getFullYear();

  // Check if today is a custody weekend (1st, 3rd, and alternate 5th weekends with Joshua)
  const isWeekend = day === 0 || day === 6;
  let custodyNote = "";

  if (isWeekend) {
    // Find which weekend of the month this is
    // Get the first day of the month
    const firstOfMonth = new Date(year, month, 1);
    const firstSaturday = firstOfMonth.getDay() <= 6
      ? (6 - firstOfMonth.getDay()) + 1
      : 1;

    // Calculate which weekend number this Saturday falls in
    let weekendNum: number;
    if (day === 6) {
      // Saturday
      weekendNum = Math.ceil((date - firstSaturday + 7) / 7);
      if (date < firstSaturday) weekendNum = 0;
      else weekendNum = Math.floor((date - firstSaturday) / 7) + 1;
    } else {
      // Sunday - belongs to previous day's weekend
      weekendNum = Math.floor((date - 1 - firstSaturday) / 7) + 1;
      if (date - 1 < firstSaturday) weekendNum = 0;
    }

    const isJoshuaWeekend =
      weekendNum === 1 ||
      weekendNum === 3 ||
      (weekendNum === 5 && month % 2 === 0); // Alternate 5th weekends

    if (isJoshuaWeekend) {
      custodyNote = "\n  ⚠️ Custody weekend: Thomas is with Joshua";
    }
  }

  const schedules: Record<number, string> = {
    1: "🏫 Pick up Thomas from Tulip Kids 5-6pm",
    2: "🏫 Pick up Thomas from Tulip 3:15pm\n  📖 Kumon reading\n  🏊 5:10pm swim lesson",
    3: "🏫 Joshua picks up Thomas from Tulip at 4pm\n  🏠 Joshua drops off Thomas at 7pm",
    4: "🏫 Pick up Thomas from Tulip 3:15pm\n  📖 Kumon reading\n  🏊 5:10pm swim lesson",
    5: "🏫 Pick up Thomas from Tulip Kids 5-6pm",
    6: "Weekend - no school",
    0: "Weekend - no school",
  };

  return (schedules[day] || "No schedule") + custodyNote;
}

// ============================================================
// GOALS FROM SUPABASE
// ============================================================

async function getActiveGoals(): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return "Supabase not configured";
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_active_goals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: "{}",
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const goals = await res.json();

    if (!goals || goals.length === 0) return "No active goals";

    return goals
      .slice(0, 5)
      .map((g: any) => {
        let line = `- ${g.content}`;
        if (g.deadline) {
          const d = new Date(g.deadline);
          line += ` (due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })})`;
        }
        return line;
      })
      .join("\n");
  } catch (e: any) {
    console.error("Goals error:", e.message);
    return "Goals unavailable";
  }
}

// ============================================================
// PLAYHOUSE STEM METRICS (Gumroad)
// ============================================================

async function getPlayhouseMetrics(): Promise<string | null> {
  // Gumroad API requires an access token
  const gumroadToken = process.env.GUMROAD_ACCESS_TOKEN;
  if (!gumroadToken) return null;

  try {
    // Get today's sales
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://api.gumroad.com/v2/sales?access_token=${gumroadToken}&after=${today}`,
    );

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.success) return null;

    const salesCount = data.sales?.length || 0;
    const revenue = data.sales?.reduce(
      (sum: number, s: any) => sum + (s.price / 100),
      0
    ) || 0;

    if (salesCount === 0) return "No sales today yet";
    return `${salesCount} sale(s) today - $${revenue.toFixed(2)} revenue`;
  } catch {
    return null;
  }
}

// ============================================================
// MOTIVATIONAL QUOTE
// ============================================================

function getMotivationalQuote(): string {
  const quotes = [
    "Small steps every day build empires.",
    "You are building something that matters.",
    "Today's effort is tomorrow's evidence.",
    "The best time to plant a tree was 20 years ago. The second best time is now.",
    "Progress, not perfection.",
    "Your consistency is your superpower.",
    "Build in public, learn in private, grow in silence.",
    "The only way to do great work is to love what you do.",
    "You don't have to be perfect to be powerful.",
    "Discipline is choosing between what you want now and what you want most.",
    "Ship it. Learn. Iterate.",
    "Every expert was once a beginner.",
    "Done is better than perfect.",
    "Your future self will thank you.",
    "The compound effect applies to effort too.",
    "One step closer than yesterday.",
    "Clarity comes from action, not thought.",
    "Build the ladder, then climb it.",
    "What you do today echoes in your tomorrow.",
    "Trust the process. The results are coming.",
    "Momentum is built one task at a time.",
    "You are the CEO. Act like it.",
    "Focus on the next right thing.",
    "Raise the bar, then clear it.",
    "Hard work in silence. Let success make the noise.",
    "You are not behind. You are building.",
    "Protect your energy like it's revenue.",
    "Start before you're ready.",
    "Your story is still being written.",
    "Make today count.",
  ];

  // Use day of year as seed for variety without randomness
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );
  return quotes[dayOfYear % quotes.length];
}

// ============================================================
// BUILD BRIEFING
// ============================================================

async function buildBriefing(): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const day = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  ).getDay();
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const sections: string[] = [];

  // Header
  sections.push(`*Good morning, Crevita!*\n${dateStr}`);

  // Weather
  try {
    const weather = await getWeather();
    sections.push(`\n*Sunnyvale Weather*\n${weather}`);
  } catch (e) {
    console.error("Weather failed:", e);
  }

  // Calendar
  try {
    const calendar = await getCalendarEvents();
    sections.push(`\n*Today's Calendar*\n${calendar}`);
  } catch (e) {
    console.error("Calendar failed:", e);
  }

  // Thomas's schedule
  const thomasSchedule = getThomasSchedule();
  sections.push(`\n*Thomas (${dayNames[day]})*\n${thomasSchedule}`);

  // Active goals
  try {
    const goals = await getActiveGoals();
    sections.push(`\n*Active Goals*\n${goals}`);
  } catch (e) {
    console.error("Goals failed:", e);
  }

  // Playhouse STEM metrics
  try {
    const metrics = await getPlayhouseMetrics();
    if (metrics) {
      sections.push(`\n*Playhouse STEM*\n${metrics}`);
    }
  } catch (e) {
    console.error("Metrics failed:", e);
  }

  // Motivational quote
  const quote = getMotivationalQuote();
  sections.push(`\n---\n_"${quote}"_`);

  return sections.join("\n");
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("Building morning briefing...");

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const briefing = await buildBriefing();

  console.log("Sending briefing...");
  const success = await sendTelegram(briefing);

  if (success) {
    console.log("Briefing sent successfully!");
  } else {
    console.error("Failed to send briefing");
    process.exit(1);
  }
}

main();
