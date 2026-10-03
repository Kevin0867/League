import "server-only";
import { prisma } from "@/lib/db";
import { DOW, isBookable } from "@/lib/domain/facilityWindows";
import { phoenixDateInput } from "@/lib/time";

// Court-time conflict avoidance (PURE-internal). A lesson can only be booked when
// the facility is open AND a court is actually free at that time — not already
// taken by a practice, a league match, another lesson, or a manual hold. There is
// no external court-booking system; this is the single source of truth for
// "is this court-time available."

export const toMin = (hhmm: string): number => {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const addMinutesHHMM = (hhmm: string, add: number): string => {
  const t = toMin(hhmm) + add;
  const h = Math.floor(t / 60), m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

// A league/championship match occupies its host facility for the evening — treat
// the whole evening as taken on a match day so a lesson can't collide with it.
const MATCH_WINDOW = { start: "17:00", end: "21:30" };

function dayWindowUtc(day: string) {
  const start = new Date(`${day}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${day}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 2);
  return { start, end };
}

/**
 * Is a court free at `facilityId` on Phoenix day `day` for [start,end] (HH:MM)?
 * Considers the facility's open windows + blackouts, existing CourtHolds,
 * practice Sessions, and league/championship Fixtures at that facility+time.
 */
export async function isCourtTimeFree(
  facilityId: string,
  day: string,
  start: string,
  end: string,
  courtsNeeded = 1,
): Promise<{ ok: boolean; reason?: string }> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { courtCount: true, courtBlocks: true, blackoutDates: { select: { date: true } } },
  });
  if (!facility) return { ok: false, reason: "no facility" };

  const dow = DOW[new Date(`${day}T12:00:00Z`).getUTCDay()];
  const book = isBookable(facility.courtBlocks, dow, start);
  if (!book.ok) return { ok: false, reason: book.reason === "blocked" ? "facility blocked then" : "outside facility hours" };
  if (facility.blackoutDates.some((b) => phoenixDateInput(b.date) === day)) return { ok: false, reason: "facility closed that day" };

  const s0 = toMin(start), s1 = toMin(end);
  const win = dayWindowUtc(day);
  const [holds, sessions, fixtures] = await Promise.all([
    prisma.courtHold.findMany({ where: { facilityId, releasedAt: null, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true, courtCount: true } }),
    prisma.session.findMany({ where: { facilityId, status: { notIn: ["CANCELLED", "RESCHEDULED"] }, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true, courtCount: true } }),
    prisma.fixture.findMany({ where: { facilityId, status: { not: "CANCELLED" }, scheduledAt: { gte: win.start, lt: win.end } }, select: { scheduledAt: true } }),
  ]);

  let used = 0;
  for (const h of holds) if (phoenixDateInput(h.date) === day && overlaps(s0, s1, toMin(h.startTime), toMin(h.endTime))) used += h.courtCount || 1;
  for (const se of sessions) if (phoenixDateInput(se.date) === day && overlaps(s0, s1, toMin(se.startTime), toMin(se.endTime))) used += se.courtCount || 1;

  // A match that evening occupies the venue — block the match window.
  const matchDay = fixtures.some((f) => phoenixDateInput(f.scheduledAt) === day);
  if (matchDay && overlaps(s0, s1, toMin(MATCH_WINDOW.start), toMin(MATCH_WINDOW.end))) {
    return { ok: false, reason: "match night at this venue" };
  }

  if (used + courtsNeeded > (facility.courtCount || 1)) return { ok: false, reason: "courts full" };
  return { ok: true };
}

/** Reserve court-time (idempotent is the caller's job). */
export async function createCourtHold(opts: {
  facilityId: string; day: string; startTime: string; endTime: string; courtCount?: number; refType: string; refId?: string | null; note?: string | null;
}): Promise<string> {
  const hold = await prisma.courtHold.create({
    data: {
      facilityId: opts.facilityId, date: new Date(`${opts.day}T12:00:00Z`),
      startTime: opts.startTime, endTime: opts.endTime, courtCount: opts.courtCount ?? 1,
      refType: opts.refType, refId: opts.refId ?? null, note: opts.note ?? null,
    },
  });
  return hold.id;
}

/** Release the hold(s) for a given ref (e.g. a cancelled/moved lesson). */
export async function releaseCourtHolds(refType: string, refId: string): Promise<void> {
  await prisma.courtHold.updateMany({ where: { refType, refId, releasedAt: null }, data: { releasedAt: new Date() } });
}
