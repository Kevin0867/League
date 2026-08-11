// Minimal iCalendar (RFC 5545) builder for the coach calendar subscription feed
// and one-off "add to calendar" downloads. Kept dependency-free.
//
// Session times are stored as a UTC calendar `date` plus "HH:MM" wall-clock
// strings in the business time zone (America/Phoenix, UTC−7 year-round — Arizona
// doesn't observe DST), so we convert those to a UTC instant with a fixed +7h.

const PHOENIX_UTC_OFFSET_HOURS = 7;

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  /// CONFIRMED (default) | CANCELLED
  cancelled?: boolean;
};

/** A UTC instant from a stored calendar date + "HH:MM" Phoenix wall-clock time. */
export function phoenixWallTimeToUtc(date: Date, hhmm: string): Date {
  const [h, m] = (hhmm || "00:00").split(":").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    (isNaN(h) ? 0 : h) + PHOENIX_UTC_OFFSET_HOURS,
    isNaN(m) ? 0 : m,
    0,
  ));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ. */
function icsStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape a text value per RFC 5545 (backslash, comma, semicolon, newlines). */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line to <=75 octets with CRLF + space continuation. */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 73) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

export function buildIcs(calendarName: string, events: IcsEvent[], now = new Date()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PURE Academy//Coach Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(calendarName)}`),
    fold(`NAME:${esc(calendarName)}`),
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const dtstamp = icsStamp(now);
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${e.uid}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${icsStamp(e.start)}`);
    lines.push(`DTEND:${icsStamp(e.end)}`);
    lines.push(fold(`SUMMARY:${esc(e.summary)}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    lines.push(`STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
