/**
 * Google Calendar API — Direct REST integration
 *
 * Replaces the slow Claude CLI + MCP approach.
 * Uses OAuth2 refresh token to fetch today's events.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   GOOGLE_CALENDAR_ID (defaults to primary)
 *
 * To get a refresh token:
 *   1. Go to console.cloud.google.com
 *   2. Create OAuth 2.0 credentials (Desktop app)
 *   3. Enable Google Calendar API
 *   4. Use OAuth playground or a one-time script to get a refresh token
 *      with scope: https://www.googleapis.com/auth/calendar.readonly
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

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

export interface CalendarEvent {
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location?: string;
}

export async function getTodayEvents(): Promise<CalendarEvent[] | null> {
  const token = await getAccessToken();
  if (!token) return null;

  // Today's time bounds in Pacific
  const now = new Date();
  const startOfDay = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      console.error("Calendar API error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const events: CalendarEvent[] = (data.items || []).map((item: any) => ({
      title: item.summary || "Untitled",
      startTime: item.start?.dateTime || item.start?.date || "",
      endTime: item.end?.dateTime || item.end?.date || "",
      allDay: !!item.start?.date,
      location: item.location || undefined,
    }));

    return events;
  } catch (e: any) {
    console.error("Calendar fetch failed:", e.message);
    return null;
  }
}

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

export function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}
