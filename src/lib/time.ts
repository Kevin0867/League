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

/** Compact "time ago" for an instant — "just now", "5m ago", "3h ago",
 *  "2d ago", "3w ago", else a MM/DD/YYYY date. For login/activity displays. */
export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  const secs = Math.round((Date.now() - dt.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.round(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return formatStamp(dt);
}

/** MM/DD/YYYY – MM/DD/YYYY range. */
export function formatDateRange(a: Date | string | null | undefined, b: Date | string | null | undefined): string {
  const s = formatDate(a), e = formatDate(b);
  if (s && e) return `${s} – ${e}`;
  return s || e || "";
}

// --- Registration-window anchoring -------------------------------------------
// Arizona has no DST, so local midnight is a fixed UTC−07:00 offset. Registration
// window dates come from <input type="date"> as a bare "YYYY-MM-DD" with no time.
// Anchor them to Phoenix local time so the cutoff lands at the intended local
// instant — NOT UTC midnight, which is 5:00 PM the previous day in Arizona.
const PHOENIX_UTC_OFFSET = "-07:00";
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Opens-on → 12:00 AM Phoenix on the given day. A full datetime passes through. */
export function phoenixWindowStart(dateStr: string | null | undefined): Date | null {
  const s = String(dateStr ?? "").trim();
  if (!s) return null;
  if (!BARE_DATE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(`${s}T00:00:00${PHOENIX_UTC_OFFSET}`);
  return isNaN(d.getTime()) ? null : d;
}

/** Closes-on → END of the given day: 12:00 AM Phoenix the FOLLOWING day, so a
 *  family can register through the whole close date and the waitlist begins at
 *  midnight. A full datetime passes through unchanged. */
export function phoenixWindowEnd(dateStr: string | null | undefined): Date | null {
  const s = String(dateStr ?? "").trim();
  const start = phoenixWindowStart(s);
  if (!start) return null;
  if (!BARE_DATE.test(s)) return start;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** "YYYY-MM-DD" for the Phoenix calendar day of an instant — for <input type="date">
 *  defaultValue so a saved window date round-trips to the same day it was entered. */
export function phoenixDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
}

/** The last day registration is open, from a closes-on instant (stored as the
 *  following midnight). MM/DD/YYYY in the academy's timezone. */
export function closeDayLabel(closesOn: Date | string | null | undefined): string {
  if (!closesOn) return "";
  const dt = typeof closesOn === "string" ? new Date(closesOn) : closesOn;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  return formatStamp(new Date(dt.getTime() - 1));
}

/** "YYYY-MM-DD" a closes-on instant maps back to for a date input (the last open day). */
export function closeDayInput(closesOn: Date | string | null | undefined): string {
  if (!closesOn) return "";
  const dt = typeof closesOn === "string" ? new Date(closesOn) : closesOn;
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  return phoenixDateInput(new Date(dt.getTime() - 1));
}
