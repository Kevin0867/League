// Time display helpers. Times are stored as 24-hour "HH:MM" strings (from HTML
// <input type="time">), but every user-facing display uses a 12-hour clock with
// AM/PM. Keep <input type="time"> values in 24-hour "HH:MM" — the control
// requires it and renders it in the user's locale itself.

/** "18:00" → "6:00 PM"; "09:30" → "9:30 AM". Empty/invalid input passes through. */
export function formatTime12(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (isNaN(h) || h < 0 || h > 23) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/** "18:00"–"20:00" → "6:00 PM – 8:00 PM". */
export function formatTimeRange12(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatTime12(start);
  const e = formatTime12(end);
  if (s && e) return `${s} – ${e}`;
  return s || e || "";
}

/** Day + time, e.g. ("MON", "18:00") → "MON at 6:00 PM". */
export function formatDayTime12(day: string | null | undefined, time: string | null | undefined): string {
  const t = formatTime12(time);
  if (day && t) return `${day} at ${t}`;
  return day || t || "";
}

// The academy operates in Arizona (no DST). True timestamps (createdAt,
// publishedAt, scheduled times, message times) display in this zone so a
// late-evening action doesn't read as the next calendar day the way UTC would.
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "America/Phoenix";

// US date formatting for all user-facing DISPLAYS (MM/DD/YYYY). Note: <input
// type="date"> values must stay ISO "YYYY-MM-DD" — the control requires it —
// so keep .toISOString().slice(0,10) for defaultValue, and use these only for
// text people read.
//
// formatDate is for calendar DATES (season start/end, DOB, registration dates)
// which are stored at midnight UTC — render in UTC so the stored day never
// shifts by a timezone. For a true timestamp shown as a bare date (e.g.
// "published on …") use formatStamp instead.
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });
}

/** MM/DD/YYYY for a true instant, in the academy's local timezone. */
export function formatStamp(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: BUSINESS_TZ });
}

/** MM/DD/YYYY, h:MM AM/PM (e.g. "09/14/2026, 6:00 PM") — in the academy's timezone. */
export function formatDateTime12(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: BUSINESS_TZ,
  });
}

/** MM/DD/YYYY – MM/DD/YYYY range. */
export function formatDateRange(a: Date | string | null | undefined, b: Date | string | null | undefined): string {
  const s = formatDate(a), e = formatDate(b);
  if (s && e) return `${s} – ${e}`;
  return s || e || "";
}
