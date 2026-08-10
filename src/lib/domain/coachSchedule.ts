import { prisma } from "@/lib/db";

// A coach may hold multiple assignments at different times and locations, as
// long as their day/time blocks don't overlap. These helpers detect a clash
// between a candidate team slot and the coach's existing team assignments
// (head coach on Team.coachId, plus assistant seats on TeamCoach).

// Team slots store only a start time, so treat each as a fixed-length block.
export const DEFAULT_TEAM_SESSION_MIN = 90;

export function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min)) return null;
  return h * 60 + min;
}

/** Do [aStart, aEnd) and [bStart, bEnd) overlap? */
export function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type CoachConflict = { teamId: string; teamName: string; dayOfWeek: string; startTime: string };

/**
 * Teams this coach already covers that clash with a candidate day/time. A clash
 * is the same day with overlapping time windows. Returns [] when the candidate
 * has no day/time (nothing to clash with) or nothing overlaps.
 */
export async function coachTeamConflicts(opts: {
  coachId: string;
  dayOfWeek: string | null | undefined;
  startTime: string | null | undefined;
  durationMin?: number;
  excludeTeamId?: string | null;
}): Promise<CoachConflict[]> {
  const { coachId, dayOfWeek, startTime, durationMin = DEFAULT_TEAM_SESSION_MIN, excludeTeamId = null } = opts;
  const start = timeToMinutes(startTime);
  if (!coachId || !dayOfWeek || start == null) return [];
  const end = start + durationMin;

  // All teams this coach is on (head or assistant) on the same day.
  const [headTeams, assistantSeats] = await Promise.all([
    prisma.team.findMany({
      where: { coachId, dayOfWeek, startTime: { not: null }, ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}) },
      select: { id: true, name: true, dayOfWeek: true, startTime: true },
    }),
    prisma.teamCoach.findMany({
      where: { coachId, team: { dayOfWeek, startTime: { not: null }, ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}) } },
      select: { team: { select: { id: true, name: true, dayOfWeek: true, startTime: true } } },
    }),
  ]);

  const candidates = [...headTeams, ...assistantSeats.map((s) => s.team)]
    // de-dup by team id (a coach could theoretically be both — guard anyway)
    .filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);

  const conflicts: CoachConflict[] = [];
  for (const t of candidates) {
    const ts = timeToMinutes(t.startTime);
    if (ts == null) continue;
    if (windowsOverlap(start, end, ts, ts + durationMin)) {
      conflicts.push({ teamId: t.id, teamName: t.name, dayOfWeek: t.dayOfWeek!, startTime: t.startTime! });
    }
  }
  return conflicts;
}

/** Same idea for a single dated session (used for single-class subs). */
export async function coachSessionConflicts(opts: {
  coachId: string;
  date: Date;
  startTime: string;
  endTime: string;
  excludeSessionId?: string | null;
}): Promise<{ sessionId: string; startTime: string; endTime: string }[]> {
  const { coachId, date, startTime, endTime, excludeSessionId = null } = opts;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (!coachId || start == null || end == null) return [];

  // Same calendar day.
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

  const seats = await prisma.sessionCoach.findMany({
    where: {
      coachId,
      session: { date: { gte: dayStart, lte: dayEnd }, status: { notIn: ["CANCELLED"] }, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
    },
    select: { session: { select: { id: true, startTime: true, endTime: true } } },
  });

  const conflicts: { sessionId: string; startTime: string; endTime: string }[] = [];
  for (const s of seats) {
    const ss = timeToMinutes(s.session.startTime);
    const se = timeToMinutes(s.session.endTime);
    if (ss == null || se == null) continue;
    if (windowsOverlap(start, end, ss, se)) {
      conflicts.push({ sessionId: s.session.id, startTime: s.session.startTime, endTime: s.session.endTime });
    }
  }
  return conflicts;
}
