// King of the Court — feeder-court championship (§14, event types). Teams are
// spread across N courts, two per court: court 1 is the "King" court at the top,
// court N the feeder at the bottom. Each round every court plays one match at
// once; the winner moves UP one court (toward the King court) and the loser
// slides DOWN one — except the King-court winner stays on top and the
// bottom-court loser stays at the bottom. Whoever holds the King court when the
// final round finishes is the champion.
//
// Nobody is eliminated — you climb or slide. Because round r+1's matchups depend
// on round r's results, the route creates every round up front (empty) and
// routes each result forward as it's recorded, exactly like the elimination
// engines. This module is pure — no database.
//
// Slot/side convention for a court in the next round:
//   • home = the team that fell from the court above (or the King stayer on
//     court 0),
//   • away = the team that rose from the court below (or the bottom stayer on
//     the last court).
// So a rising winner always lands in the away seat, a falling loser in the home
// seat, and the two stayers keep their end court.

export type KotcMatch = {
  bracket: "KOTC";
  round: number;
  slot: number; // court index; 0 = King court (court 1)
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

/** Court count: two teams per court, rounding up. An odd field leaves one
 *  bottom-court bye seat. */
export function kotcCourts(n: number): number {
  return Math.max(1, Math.ceil(n / 2));
}

/** Default rounds: enough for a bottom team to climb to the top and defend
 *  once, bounded so the schedule stays reasonable. */
export function kotcDefaultRounds(courts: number): number {
  return Math.min(12, Math.max(1, courts));
}

/** Build round 1: court c seats seeds 2c and 2c+1 (0-indexed into the seeded
 *  list); a seat past the field is a bye (null). Stronger seat is home. */
export function buildKotcRound1(seededTeamIds: string[]): { courts: number; matches: KotcMatch[] } {
  const n = seededTeamIds.length;
  const courts = kotcCourts(n);
  const matches: KotcMatch[] = [];
  for (let c = 0; c < courts; c++) {
    const hi = 2 * c;
    const ai = 2 * c + 1;
    const homeTeamId = hi < n ? seededTeamIds[hi] : null;
    const awayTeamId = ai < n ? seededTeamIds[ai] : null;
    matches.push({
      bracket: "KOTC",
      round: 1,
      slot: c,
      homeTeamId,
      awayTeamId,
      homeSeed: homeTeamId ? hi + 1 : null,
      awaySeed: awayTeamId ? ai + 1 : null,
    });
  }
  return { courts, matches };
}

/** Where a court's winner goes next round. The King (court 0) stays home; every
 *  other winner rises one court and lands in the away seat. */
export function kotcWinnerTarget(courts: number, court: number): { court: number; asHome: boolean } {
  if (court <= 0) return { court: 0, asHome: true };
  return { court: court - 1, asHome: false };
}

/** Where a court's loser goes next round. The bottom-court loser stays in the
 *  away seat; every other loser falls one court and lands in the home seat. */
export function kotcLoserTarget(courts: number, court: number): { court: number; asHome: boolean } {
  if (court >= courts - 1) return { court: courts - 1, asHome: false };
  return { court: court + 1, asHome: true };
}

/** The away seat of the bottom court is structurally empty (a perpetual bye)
 *  exactly when the field is odd; every other seat fills from play. */
export function kotcDeadAway(courts: number, oddField: boolean, court: number): boolean {
  return oddField && court === courts - 1;
}

export type KotcStanding = {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  finalCourt: number; // court index the team currently sits on (0 = King court)
};

/**
 * Roll King-of-the-Court matches into a table ordered by current court (top
 * first), then wins, then point differential. Only played (COMPLETED) matches
 * count toward the win/loss record — a BYE moves a team without crediting a win.
 * `king` is the winner of the final round's King court, once that match is
 * decided.
 */
export function kotcStandings(
  matches: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    winnerTeamId: string | null;
    homeScore: number | null;
    awayScore: number | null;
    status: string;
    round: number;
    slot: number;
  }[],
): { table: KotcStanding[]; king: string | null } {
  const rows = new Map<string, KotcStanding>();
  const deepestRound = new Map<string, number>();
  const row = (id: string): KotcStanding => {
    let s = rows.get(id);
    if (!s) {
      s = { teamId: id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, finalCourt: 0 };
      rows.set(id, s);
    }
    return s;
  };

  let maxRound = 0;
  for (const m of matches) maxRound = Math.max(maxRound, m.round);

  for (const m of matches) {
    for (const id of [m.homeTeamId, m.awayTeamId]) {
      if (!id) continue;
      const s = row(id);
      const prev = deepestRound.get(id) ?? -1;
      if (m.round >= prev) {
        deepestRound.set(id, m.round);
        s.finalCourt = m.slot;
      }
    }
    if (m.status !== "COMPLETED" || !m.winnerTeamId || !m.homeTeamId || !m.awayTeamId) continue;
    const h = row(m.homeTeamId);
    const a = row(m.awayTeamId);
    if (m.homeScore != null && m.awayScore != null) {
      h.pointsFor += m.homeScore; h.pointsAgainst += m.awayScore;
      a.pointsFor += m.awayScore; a.pointsAgainst += m.homeScore;
    }
    if (m.winnerTeamId === m.homeTeamId) { h.wins++; a.losses++; }
    else { a.wins++; h.losses++; }
  }
  for (const s of rows.values()) s.diff = s.pointsFor - s.pointsAgainst;

  let king: string | null = null;
  const topFinal = matches.find((m) => m.round === maxRound && m.slot === 0);
  if (topFinal && topFinal.status === "COMPLETED" && topFinal.winnerTeamId) king = topFinal.winnerTeamId;

  const table = [...rows.values()].sort(
    (x, y) => x.finalCourt - y.finalCourt || y.wins - x.wins || y.diff - x.diff,
  );
  return { table, king };
}
