import "server-only";
import { prisma } from "@/lib/db";
import { formatTime12, BUSINESS_TZ } from "@/lib/time";

// A human, complete practice line for launch / welcome / assignment comms:
// day (plural), start–end time (practices run two hours), and when they begin —
// the team's first scheduled practice date if it exists, otherwise "the week of"
// the season start. Example: "Tuesdays, 7:00 AM – 9:00 AM · starting the week of Sept 13".

const DAY_PLURAL: Record<string, string> = {
  MON: "Mondays", TUE: "Tuesdays", WED: "Wednesdays", THU: "Thursdays",
  FRI: "Fridays", SAT: "Saturdays", SUN: "Sundays",
};

/** "WED" → "Wednesdays" (the day code the Team stores). Returns the code itself if unknown. */
export function dayOfWeekPlural(code: string | null | undefined): string | null {
  if (!code) return null;
  return DAY_PLURAL[code.toUpperCase()] ?? code;
}

// Sun=0 … Sat=6, to match JS getUTCDay().
const DOW_INDEX: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

const PRACTICE_HOURS = 2;

/**
 * The team's first practice date: the first occurrence of its weekday during the
 * season's opening week. The season starts "the week of" its start date, so we
 * anchor to the Sunday of that week and step to the team's day — e.g. a season
 * that starts the week of Sun Sep 13 gives Monday teams Sep 14, Tuesday Sep 15.
 */
export function firstPracticeDate(seasonStart: Date, dayCode: string): Date | null {
  const target = DOW_INDEX[dayCode];
  if (target === undefined) return null;
  // Read the season start's calendar date in the business timezone, then do the
  // day math on a UTC noon date (stable, DST-free).
  const [y, m, d] = seasonStart.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ }).split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const sunday = new Date(anchor);
  sunday.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay()); // back up to that week's Sunday
  const result = new Date(sunday);
  result.setUTCDate(sunday.getUTCDate() + target); // step forward to the team's weekday
  return result;
}

/** Add whole hours to an "HH:MM" 24h time, clamped to the same day. */
export function addHoursHHMM(hhmm: string | null | undefined, hours: number): string | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10) + hours;
  if (isNaN(h)) return null;
  return `${String(Math.min(23, h)).padStart(2, "0")}:${m[2]}`;
}

/** "7:00 AM – 9:00 AM" from a start time (+ explicit end, else start + 2h). */
export function practiceTimeRange(startTime: string | null | undefined, endTime?: string | null): string | null {
  if (!startTime) return null;
  const start = formatTime12(startTime);
  const end = formatTime12(endTime || addHoursHHMM(startTime, PRACTICE_HOURS) || "");
  return end ? `${start} – ${end}` : start;
}

function monthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TZ });
}
function weekdayMonthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: BUSINESS_TZ });
}

/**
 * Full practice line for a team. Looks up the team's first scheduled practice
 * (real date + end time) and the season start; falls back to the team's stored
 * day/time and "the week of" the season start when practices aren't generated
 * yet. Returns a to-be-confirmed message when there's no schedule at all.
 */
export async function describeTeamPractice(
  team: { id: string; dayOfWeek: string | null; startTime: string | null },
  seasonId: string,
): Promise<string> {
  const [firstPractice, season] = await Promise.all([
    prisma.session.findFirst({
      where: { seasonId, type: "PRACTICE", teams: { some: { teamId: team.id } }, status: { in: ["SCHEDULED", "RESCHEDULED"] } },
      orderBy: { date: "asc" },
      select: { date: true, startTime: true, endTime: true },
    }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { startDate: true } }),
  ]);

  const day = team.dayOfWeek ? DAY_PLURAL[team.dayOfWeek] ?? team.dayOfWeek : null;
  const startTime = firstPractice?.startTime ?? team.startTime;
  const endTime = firstPractice?.endTime ?? null;
  const range = practiceTimeRange(startTime, endTime);

  const dayTime = [day, range].filter(Boolean).join(", ");
  if (!dayTime) return "A day and time to be confirmed";

  // When practices begin: the exact first-practice date if the schedule exists;
  // otherwise the first occurrence of the team's weekday in the season's opening
  // week (Mon → Sep 14, Tue → Sep 15…); else just "the week of" the start.
  let begins = "";
  if (firstPractice?.date) {
    begins = ` · starting ${weekdayMonthDay(firstPractice.date)}`;
  } else if (season?.startDate) {
    const computed = team.dayOfWeek ? firstPracticeDate(season.startDate, team.dayOfWeek) : null;
    begins = computed ? ` · starting ${weekdayMonthDay(computed)}` : ` · starting the week of ${monthDay(season.startDate)}`;
  }

  return `${dayTime}${begins}`;
}

/**
 * The date the team meets each of the first `weeks` weeks, derived purely from
 * the season's opening week and the team's weekday — Week 1 is the first
 * occurrence of that weekday, then +7 days each week. Returns [] when the team
 * has no weekday or the season no start date.
 */
export function weeklyPracticeDates(seasonStart: Date | null | undefined, dayCode: string | null | undefined, weeks: number): Date[] {
  if (!seasonStart || !dayCode) return [];
  const first = firstPracticeDate(seasonStart, dayCode);
  if (!first) return [];
  const out: Date[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(first);
    d.setUTCDate(first.getUTCDate() + i * 7);
    out.push(d);
  }
  return out;
}

export type WeekSlot = { week: number; date: Date | null; scheduled: boolean };

/**
 * Maps each coaching week (1..weeks) to the calendar date the team meets that
 * week, so week labels line up with the real schedule. Prefers actual generated
 * PRACTICE sessions (in date order); when none exist yet, falls back to the
 * planned dates from the season start + the team's day/time. `scheduled` marks
 * whether that week's date came from a real session (check-in ready) or is a
 * plan derived from the team's meeting day.
 */
export async function teamWeekSchedule(
  team: { id: string; dayOfWeek: string | null; startTime: string | null },
  seasonId: string,
  weeks: number,
): Promise<{ slots: WeekSlot[]; timeRange: string | null; hasSessions: boolean }> {
  const [practices, season] = await Promise.all([
    prisma.session.findMany({
      where: { seasonId, type: "PRACTICE", teams: { some: { teamId: team.id } }, status: { in: ["SCHEDULED", "RESCHEDULED"] } },
      orderBy: { date: "asc" },
      select: { date: true, startTime: true, endTime: true },
    }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { startDate: true } }),
  ]);

  const planned = weeklyPracticeDates(season?.startDate, team.dayOfWeek, weeks);
  const slots: WeekSlot[] = [];
  for (let i = 0; i < weeks; i++) {
    if (practices[i]) slots.push({ week: i + 1, date: practices[i].date, scheduled: true });
    else if (planned[i]) slots.push({ week: i + 1, date: planned[i], scheduled: false });
    else slots.push({ week: i + 1, date: null, scheduled: false });
  }

  const startTime = practices[0]?.startTime ?? team.startTime;
  const endTime = practices[0]?.endTime ?? null;
  return { slots, timeRange: practiceTimeRange(startTime, endTime), hasSessions: practices.length > 0 };
}

