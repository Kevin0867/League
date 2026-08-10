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
