/**
 * Timing Guard
 *
 * Prevents workers from firing outside their designated time window.
 * Protects against spurious execution on PM2 restart, process recovery,
 * or system reboot. Workers silently exit if the time/day condition is not met.
 *
 * All times are in America/Los_Angeles (Pacific Time).
 */

const TZ = "America/Los_Angeles";

interface TimingWindow {
  /** Days of week: 0=Sunday, 1=Monday, ..., 6=Saturday. Omit for every day. */
  days?: number[];
  /** Earliest hour:minute to run (inclusive), e.g. "8:45" */
  earliest: string;
  /** Latest hour:minute to run (inclusive), e.g. "9:15" */
  latest: string;
}

function getPacificNow(): { day: number; hour: number; minute: number } {
  const now = new Date();
  const pacificStr = now.toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  // Parse "Mon, 09:30" or "Wed, 20:00"
  const pacific = new Date(
    now.toLocaleString("en-US", { timeZone: TZ })
  );

  return {
    day: pacific.getDay(),
    hour: pacific.getHours(),
    minute: pacific.getMinutes(),
  };
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h, minute: m };
}

function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Check if the current Pacific time is within the allowed window.
 * If not, log a message and exit the process silently (exit code 0).
 *
 * @param label - Worker name for logging
 * @param window - The allowed execution window
 */
export function guardTiming(label: string, window: TimingWindow): void {
  if (process.env.FORCE_RUN === "1") {
    console.log(`[${label}] FORCE_RUN=1, skipping timing guard.`);
    return;
  }

  const now = getPacificNow();
  const nowMinutes = toMinutes(now.hour, now.minute);
  const earliest = parseTime(window.earliest);
  const latest = parseTime(window.latest);
  const earliestMinutes = toMinutes(earliest.hour, earliest.minute);
  const latestMinutes = toMinutes(latest.hour, latest.minute);

  // Check day of week
  if (window.days && !window.days.includes(now.day)) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const allowed = window.days.map((d) => dayNames[d]).join(", ");
    console.log(
      `[${label}] Timing guard: today is ${dayNames[now.day]}, ` +
      `only runs on ${allowed}. Exiting silently.`
    );
    process.exit(0);
  }

  // Check time window
  if (nowMinutes < earliestMinutes || nowMinutes > latestMinutes) {
    const pad = (n: number) => String(n).padStart(2, "0");
    console.log(
      `[${label}] Timing guard: current time is ${pad(now.hour)}:${pad(now.minute)} PT, ` +
      `allowed window is ${window.earliest}-${window.latest} PT. Exiting silently.`
    );
    process.exit(0);
  }
}
