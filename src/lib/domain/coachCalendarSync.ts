import "server-only";
import { prisma } from "@/lib/db";
import { parseIcsBusy } from "@/lib/domain/icsParse";

// Fetch each coach's external calendar feed (Coach.externalCalendarUrl) and cache
// their busy intervals as CoachBusyBlock rows, which the slot engine subtracts.
// One-way, read-only, no OAuth — the coach pastes a "secret iCal" subscribe link.
// Each sync rewrites that coach's rows for the horizon, so a removed event frees
// up again next run.

const HORIZON_DAYS = 70;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 4_000_000; // ignore absurdly large feeds

async function fetchIcs(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Many providers hand out webcal:// links — same content over https.
    const httpsUrl = url.replace(/^webcal:\/\//i, "https://");
    const res = await fetch(httpsUrl, { signal: ctrl.signal, redirect: "follow", headers: { Accept: "text/calendar, text/plain, */*" } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_BYTES) return text.slice(0, MAX_BYTES);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CalendarSyncResult = { coaches: number; synced: number; failed: number; blocks: number };

/** Sync ONE coach's calendar right now (used by the "Sync now" button). Returns
 *  the number of busy blocks imported, or null if the fetch/parse failed. */
export async function syncOneCoachCalendar(coachId: string, now: Date): Promise<{ ok: boolean; blocks: number }> {
  const c = await prisma.coach.findUnique({ where: { id: coachId }, select: { id: true, externalCalendarUrl: true } });
  const url = (c?.externalCalendarUrl ?? "").trim();
  if (!url || (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url))) return { ok: false, blocks: 0 };
  const raw = await fetchIcs(url);
  if (!raw || !/BEGIN:VCALENDAR/i.test(raw)) return { ok: false, blocks: 0 };
  const windowStart = new Date(now.getTime() - 1 * 86400000);
  const windowEnd = new Date(now.getTime() + HORIZON_DAYS * 86400000);
  const events = parseIcsBusy(raw, windowStart, windowEnd);
  const fetchedAt = new Date();
  await prisma.$transaction([
    prisma.coachBusyBlock.deleteMany({ where: { coachId } }),
    ...(events.length
      ? [prisma.coachBusyBlock.createMany({
          data: events.map((e) => ({
            coachId, startAt: e.start, endAt: e.end, allDay: e.allDay,
            summary: e.summary?.slice(0, 200) ?? null, uid: e.uid?.slice(0, 200) ?? null,
            sourceUrl: url.slice(0, 500), fetchedAt,
          })),
        })]
      : []),
  ]);
  return { ok: true, blocks: events.length };
}

/** Sync every coach that has a calendar URL. Returns run counters. */
export async function syncAllCoachCalendars(now: Date): Promise<CalendarSyncResult> {
  const coaches = await prisma.coach.findMany({
    where: { externalCalendarUrl: { not: null } },
    select: { id: true, externalCalendarUrl: true },
  });
  const result: CalendarSyncResult = { coaches: coaches.length, synced: 0, failed: 0, blocks: 0 };

  const windowStart = new Date(now.getTime() - 1 * 86400000);
  const windowEnd = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  for (const c of coaches) {
    const url = (c.externalCalendarUrl ?? "").trim();
    if (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) { result.failed++; continue; }
    const raw = await fetchIcs(url);
    if (!raw || !/BEGIN:VCALENDAR/i.test(raw)) { result.failed++; continue; }

    const events = parseIcsBusy(raw, windowStart, windowEnd);
    const fetchedAt = new Date();
    // Rewrite this coach's cached busy blocks atomically: drop the old, insert new.
    await prisma.$transaction([
      prisma.coachBusyBlock.deleteMany({ where: { coachId: c.id } }),
      ...(events.length
        ? [prisma.coachBusyBlock.createMany({
            data: events.map((e) => ({
              coachId: c.id, startAt: e.start, endAt: e.end, allDay: e.allDay,
              summary: e.summary?.slice(0, 200) ?? null, uid: e.uid?.slice(0, 200) ?? null,
              sourceUrl: url.slice(0, 500), fetchedAt,
            })),
          })]
        : []),
    ]);
    result.synced++;
    result.blocks += events.length;
  }
  return result;
}
