import "server-only";

// A small, dependency-free iCalendar reader for importing a coach's external
// phone/work calendar as BUSY intervals. We only need enough of RFC 5545 to know
// WHEN the coach is unavailable: VEVENT DTSTART/DTEND, all-day events, STATUS,
// and simple weekly/daily RRULEs (the "every Tuesday" case). Anything exotic is
// skipped rather than guessed.
//
// Timezone handling (pragmatic for a Phoenix-based academy, no tz database):
//   • A UTC time ("…Z") is used exactly.
//   • A VALUE=DATE (all-day) event blocks the whole Phoenix day(s) it spans.
//   • A floating time or a TZID time is interpreted as Phoenix wall-clock
//     (America/Phoenix is UTC−7 all year). This is correct for local coaches and
//     a safe over-block otherwise (it only ever marks the coach busy).

const PHX_OFFSET_H = 7;

export type BusyEvent = { uid: string; start: Date; end: Date; allDay: boolean; summary: string | null; cancelled: boolean };

/** Unfold RFC 5545 content lines (a CRLF/LF followed by space or tab continues). */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** Split "NAME;PARAM=x;PARAM2=y:value" → { name, params, value }. */
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

/** Parse an ICS date/time value into a UTC instant + whether it's an all-day DATE. */
function parseDt(value: string, params: Record<string, string>): { at: Date; allDay: boolean } | null {
  const v = value.trim();
  // All-day: YYYYMMDD
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    if (!y) return null;
    // Start of that Phoenix day as a UTC instant (00:00 PHX = 07:00 UTC).
    return { at: new Date(Date.UTC(y, mo - 1, d, PHX_OFFSET_H, 0, 0)), allDay: true };
  }
  // Date-time: YYYYMMDDTHHMMSS(Z)?
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return { at: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  // Floating / TZID → treat as Phoenix wall-clock.
  return { at: new Date(Date.UTC(+y, +mo - 1, +d, +h + PHX_OFFSET_H, +mi, +s)), allDay: false };
}

const DAY_MS = 86400000;
const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Expand a simple RRULE (FREQ=DAILY|WEEKLY, INTERVAL, COUNT, UNTIL, weekly BYDAY)
 *  into extra start instants within [windowStart, windowEnd]. Capped. */
function expandRrule(rrule: string, start: Date, windowStart: Date, windowEnd: Date): Date[] {
  const parts: Record<string, string> = {};
  for (const kv of rrule.split(";")) { const [k, val] = kv.split("="); if (k && val) parts[k.toUpperCase()] = val.toUpperCase(); }
  const freq = parts.FREQ;
  if (freq !== "WEEKLY" && freq !== "DAILY") return [];
  const interval = Math.max(1, parseInt(parts.INTERVAL || "1", 10) || 1);
  const count = parts.COUNT ? Math.max(1, parseInt(parts.COUNT, 10) || 1) : null;
  let until: Date | null = null;
  if (parts.UNTIL) { const p = parseDt(parts.UNTIL, {}); until = p?.at ?? null; }
  const hardEnd = until && until < windowEnd ? until : windowEnd;

  const byDays = freq === "WEEKLY" && parts.BYDAY
    ? parts.BYDAY.split(",").map((d) => WEEKDAY[d.slice(-2)]).filter((n) => n != null)
    : [start.getUTCDay()];

  const out: Date[] = [];
  const stepDays = freq === "DAILY" ? interval : 7 * interval;
  let emitted = 0;
  // Walk week/day periods from the start; for weekly, emit each selected weekday.
  for (let base = new Date(start), guard = 0; base <= hardEnd && guard < 400; base = new Date(base.getTime() + stepDays * DAY_MS), guard++) {
    if (freq === "WEEKLY") {
      // Anchor to the Sunday of this period, then add each BYDAY offset.
      const weekStart = new Date(base.getTime() - base.getUTCDay() * DAY_MS);
      for (const wd of byDays) {
        const occ = new Date(weekStart.getTime() + wd * DAY_MS);
        occ.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
        if (occ < start) continue;
        if (occ > hardEnd) continue;
        if (occ >= windowStart) out.push(new Date(occ));
        emitted++;
        if (count && emitted >= count) return dedupeSorted(out);
      }
    } else {
      if (base >= windowStart && base <= hardEnd) out.push(new Date(base));
      emitted++;
      if (count && emitted >= count) break;
    }
  }
  return dedupeSorted(out);
}

function dedupeSorted(ds: Date[]): Date[] {
  const seen = new Set<number>();
  const out: Date[] = [];
  for (const d of ds.sort((a, b) => a.getTime() - b.getTime())) { if (!seen.has(d.getTime())) { seen.add(d.getTime()); out.push(d); } }
  return out;
}

/**
 * Parse an ICS document into busy events whose start falls within
 * [windowStart, windowEnd]. Cancelled/transparent events are dropped. Simple
 * recurrences are expanded. Caps total events to stay bounded.
 */
export function parseIcsBusy(raw: string, windowStart: Date, windowEnd: Date, maxEvents = 500): BusyEvent[] {
  const lines = unfold(raw);
  const events: BusyEvent[] = [];
  let cur: { uid?: string; start?: { at: Date; allDay: boolean }; end?: { at: Date; allDay: boolean }; summary?: string; status?: string; transp?: string; rrule?: string; durationMs?: number } | null = null;

  for (const line of lines) {
    const up = line.toUpperCase();
    if (up === "BEGIN:VEVENT") { cur = {}; continue; }
    if (up === "END:VEVENT") {
      if (cur && cur.start) finalizeEvent(cur, events, windowStart, windowEnd);
      cur = null;
      if (events.length >= maxEvents) break;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case "UID": cur.uid = p.value.trim(); break;
      case "SUMMARY": cur.summary = p.value.trim(); break;
      case "STATUS": cur.status = p.value.trim().toUpperCase(); break;
      case "TRANSP": cur.transp = p.value.trim().toUpperCase(); break;
      case "RRULE": cur.rrule = p.value.trim(); break;
      case "DTSTART": { const dt = parseDt(p.value, p.params); if (dt) cur.start = dt; break; }
      case "DTEND": { const dt = parseDt(p.value, p.params); if (dt) cur.end = dt; break; }
      case "DURATION": { const ms = parseDuration(p.value); if (ms) cur.durationMs = ms; break; }
      default: break;
    }
  }
  return events.slice(0, maxEvents);
}

function finalizeEvent(
  cur: { uid?: string; start?: { at: Date; allDay: boolean }; end?: { at: Date; allDay: boolean }; summary?: string; status?: string; transp?: string; rrule?: string; durationMs?: number },
  out: BusyEvent[],
  windowStart: Date,
  windowEnd: Date,
) {
  if (!cur.start) return;
  const cancelled = cur.status === "CANCELLED";
  if (cancelled || cur.transp === "TRANSPARENT") return; // free time → not busy
  const allDay = cur.start.allDay;
  // Determine the event's duration.
  let durMs: number;
  if (cur.end) durMs = Math.max(0, cur.end.at.getTime() - cur.start.at.getTime());
  else if (cur.durationMs) durMs = cur.durationMs;
  else durMs = allDay ? DAY_MS : 60 * 60 * 1000; // default 1h for a lone DTSTART
  if (allDay && !cur.end) durMs = DAY_MS;

  const uid = cur.uid || `${cur.start.at.getTime()}`;
  const summary = cur.summary ?? null;

  const starts = cur.rrule
    ? expandRrule(cur.rrule, cur.start.at, windowStart, windowEnd)
    : [cur.start.at];
  // Always include the base start if it's in-window and not already present.
  if (!cur.rrule && (cur.start.at < windowStart || cur.start.at > windowEnd)) {
    // single event outside the window → skip
    return;
  }
  let i = 0;
  for (const s of starts) {
    if (s < windowStart || s > windowEnd) continue;
    out.push({ uid: cur.rrule ? `${uid}#${i++}` : uid, start: s, end: new Date(s.getTime() + durMs), allDay, summary, cancelled: false });
  }
}

/** Parse an RFC 5545 DURATION like "PT1H30M" / "P1D" → milliseconds. */
function parseDuration(v: string): number | null {
  const m = v.trim().match(/^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w || 0)) * 7 * 86400 + (+(d || 0)) * 86400 + (+(h || 0)) * 3600 + (+(mi || 0)) * 60 + (+(s || 0))) * 1000;
  return sign === "-" ? -ms : ms;
}
