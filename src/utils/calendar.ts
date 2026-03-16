/**
 * Google Calendar API — Direct REST integration
 *
 * COO: today's events in morning briefing, tomorrow preview in EOD
 * Household: calendar-aware scheduling reminders
 * Any agent: createEvent (Tier 2, requires CEO approval)
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   GOOGLE_CALENDAR_ID (defaults to primary)
 *
 * Current token scopes: calendar.readonly, gmail.readonly, gmail.send
 * Note: createEvent requires calendar.events scope. Re-run
 *   get-google-token.ts with the updated scope to enable writes.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

let cachedAccessToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;

  // Return cached token if still valid (with 60s buffer)
  if (cachedAccessToken && Date.now() < cachedAccessToken.expires - 60000) {
    return cachedAccessToken.token;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("Google OAuth error:", await res.text());
      return null;
    }

    const data = await res.json();
    cachedAccessToken = {
      token: data.access_token,
      expires: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  } catch (e: any) {
    console.error("Google token refresh failed:", e.message);
    return null;
  }
}

// ============================================================
// TYPES
// ============================================================

export interface CalendarEvent {
  id?: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location?: string;
  description?: string;
}

export interface CreateEventInput {
  title: string;
  startTime: string; // ISO 8601 datetime or YYYY-MM-DD for all-day
  endTime: string;
  location?: string;
  description?: string;
  allDay?: boolean;
}

export interface CreateEventResult {
  id: string;
  title: string;
  url: string;
}

// ============================================================
// INTERNAL: Fetch events for a time range
// ============================================================

async function fetchEvents(timeMin: string, timeMax: string, maxResults: number = 20): Promise<CalendarEvent[] | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults),
  });

  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      console.error("Calendar API error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return (data.items || []).map((item: any) => ({
      id: item.id,
      title: item.summary || "Untitled",
      startTime: item.start?.dateTime || item.start?.date || "",
      endTime: item.end?.dateTime || item.end?.date || "",
      allDay: !!item.start?.date,
      location: item.location || undefined,
      description: item.description || undefined,
    }));
  } catch (e: any) {
    console.error("Calendar fetch failed:", e.message);
    return null;
  }
}

// ============================================================
// READ: Today's events
// ============================================================

export async function getTodayEvents(): Promise<CalendarEvent[] | null> {
  const now = new Date();
  const startOfDay = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  return fetchEvents(startOfDay.toISOString(), endOfDay.toISOString());
}

// ============================================================
// READ: Upcoming events (next N days)
// ============================================================

export async function getUpcomingEvents(daysAhead: number = 7): Promise<CalendarEvent[] | null> {
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return fetchEvents(now.toISOString(), end.toISOString(), 50);
}

// ============================================================
// WRITE: Create event (Tier 2 — requires CEO approval)
// ============================================================

/**
 * Create a calendar event. Requires calendar.events scope.
 * Currently the token only has calendar.readonly; re-run
 * get-google-token.ts with updated scopes to enable this.
 */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const body: any = {
    summary: input.title,
    location: input.location || undefined,
    description: input.description || undefined,
  };

  if (input.allDay) {
    body.start = { date: input.startTime };
    body.end = { date: input.endTime };
  } else {
    body.start = { dateTime: input.startTime, timeZone: "America/Los_Angeles" };
    body.end = { dateTime: input.endTime, timeZone: "America/Los_Angeles" };
  }

  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Calendar create event error:", res.status, errText);
      if (res.status === 403) {
        console.error("Hint: re-run get-google-token.ts with calendar.events scope");
      }
      return null;
    }

    const event = await res.json();
    return {
      id: event.id,
      title: event.summary,
      url: event.htmlLink || "",
    };
  } catch (e: any) {
    console.error("Calendar createEvent failed:", e.message);
    return null;
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Ping the Calendar API. Returns status for dashboard health check.
 */
export async function checkStatus(): Promise<"ok" | "error" | "not configured"> {
  if (!isConfigured()) return "not configured";

  try {
    const token = await getAccessToken();
    if (!token) return "error";

    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 60000).toISOString(),
      maxResults: "1",
    });

    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ============================================================
// FORMATTERS
// ============================================================

export function formatEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return "No events today";

  return events
    .map((e) => {
      if (e.allDay) return `- All day: ${e.title}`;
      const time = new Date(e.startTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Los_Angeles",
      });
      let line = `- ${time}: ${e.title}`;
      if (e.location) line += ` (${e.location})`;
      return line;
    })
    .join("\n");
}

export function formatUpcomingEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return "No upcoming events";

  let currentDate = "";
  const lines: string[] = [];

  for (const e of events) {
    const dateStr = new Date(e.startTime).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/Los_Angeles",
    });

    if (dateStr !== currentDate) {
      currentDate = dateStr;
      lines.push(`*${dateStr}*`);
    }

    if (e.allDay) {
      lines.push(`  - All day: ${e.title}`);
    } else {
      const time = new Date(e.startTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Los_Angeles",
      });
      let line = `  - ${time}: ${e.title}`;
      if (e.location) line += ` (${e.location})`;
      lines.push(line);
    }
  }

  return lines.join("\n");
}

export function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}
