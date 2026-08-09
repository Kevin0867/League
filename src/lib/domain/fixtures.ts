// Fixture generation (§14). Round-robin across five league weeks from the week
// of October 26. No matches the weekend of December 5–6, and Thanksgiving week
// is dark. Minimum four teams per division (consolidate adjacent bands where a
// division is short — surfaced as a warning here, enacted by staff).

const LEAGUE_WEEKS = 5;

export type RRPair = { homeId: string | null; awayId: string | null };

/**
 * Circle-method round robin. Returns one array of pairings per round. With an
 * odd number of teams a bye (null) rotates through.
 */
export function roundRobin(teamIds: string[]): RRPair[][] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("BYE");
  const n = ids.length;
  const rounds: RRPair[][] = [];
  const arr = [...ids];

  for (let r = 0; r < n - 1; r++) {
    const pairs: RRPair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      const homeId = a === "BYE" ? null : a;
      const awayId = b === "BYE" ? null : b;
      // Alternate home/away by round for fairness.
      if (r % 2 === 0) pairs.push({ homeId, awayId });
      else pairs.push({ homeId: awayId, awayId: homeId });
    }
    rounds.push(pairs);
    // Rotate all but the first element.
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

function isSameDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** Dec 5–6 2026 weekend is explicitly excluded (§14). */
function isDec5or6Weekend(d: Date) {
  return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 11 && (d.getUTCDate() === 5 || d.getUTCDate() === 6);
}

/**
 * Produce up to five weekly league dates starting from `start`, skipping
 * blackout dates and the Dec 5–6 weekend. Rescheduled fixtures also may not land
 * on those dates — the same guard is reused when rebooking.
 */
export function leagueWeekDates(start: Date, blackouts: Date[], count = LEAGUE_WEEKS): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 12, 0, 0));
  let guard = 0;
  while (dates.length < count && guard++ < 60) {
    const blocked = blackouts.some((b) => isSameDay(b, cursor)) || isDec5or6Weekend(cursor);
    if (!blocked) dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}

export function divisionMeetsMinimum(teamCount: number): boolean {
  return teamCount >= 4;
}

export { LEAGUE_WEEKS };
