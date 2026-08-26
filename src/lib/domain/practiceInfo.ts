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

const PRACTICE_HOURS = 2;

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

  // When practices begin: exact first-practice date if we have it, else the
  // week of the season start.
  let begins = "";
  if (firstPractice?.date) begins = ` · starting ${weekdayMonthDay(firstPractice.date)}`;
  else if (season?.startDate) begins = ` · starting the week of ${monthDay(season.startDate)}`;

  return `${dayTime}${begins}`;
}
