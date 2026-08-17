// King of the Court — a round-robin championship (§14, event types). Every
// eligible team plays every other team once; the "King" is whoever tops the
// table at the end (most match wins, point differential as the tiebreak). This
// is the honest team-championship reading of "King of the Court": nobody is
// knocked out on a single loss, everyone plays the same schedule, and one team
// finishes on top.
//
// Rounds are built with the circle method so each round is a balanced set of
// simultaneous head-to-heads. With an odd field one team sits out each round
// (a rotating bye), which we model by simply not emitting that pairing — every
// created match has two real teams and is immediately playable.
//
// Everything here is pure so it can be unit-tested without a database. Results
// don't advance anywhere (unlike an elimination bracket) — each match stands on
// its own and the standings roll them up.

export type RRMatch = {
  bracket: "RR";
  round: number;
  slot: number;
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

/**
 * Build the full round-robin schedule for a list of teams already ordered by
 * seed (index 0 = seed 1). Returns one match per distinct pair, grouped into
 * balanced rounds. A field of n teams plays n-1 rounds (n rounds when odd,
 * with a rotating sit-out).
 */
export function buildRoundRobin(seededTeamIds: string[]): { rounds: number; matches: RRMatch[] } {
  const seedOf = new Map(seededTeamIds.map((id, i) => [id, i + 1] as const));

  // Circle method needs an even count; pad with a null "bye" seat when odd.
  const seats: (string | null)[] = [...seededTeamIds];
  if (seats.length % 2 === 1) seats.push(null);

  const n = seats.length;
  const rounds = Math.max(1, n - 1);
  const half = n / 2;

  const matches: RRMatch[] = [];
  // arr[0] is fixed; the remaining seats rotate one step each round.
  const arr = seats.slice();
  for (let r = 0; r < rounds; r++) {
    let slot = 0;
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // Skip any pairing that includes the padding seat — that's the sit-out.
      if (a == null || b == null) continue;
      matches.push({
        bracket: "RR",
        round: r + 1,
        slot,
        homeTeamId: a,
        awayTeamId: b,
        homeSeed: seedOf.get(a) ?? null,
        awaySeed: seedOf.get(b) ?? null,
      });
      slot++;
    }
    // Rotate everything except the fixed first seat.
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(1, arr.length - 1, ...rest);
  }

  return { rounds, matches };
}

export type RRStanding = {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
};

/**
 * Roll completed round-robin matches into a King-of-the-Court table, ordered by
 * wins, then point differential, then points scored. Only COMPLETED matches
 * with a winner count toward the record.
 */
export function roundRobinStandings(
  matches: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    winnerTeamId: string | null;
    homeScore: number | null;
    awayScore: number | null;
    status: string;
  }[],
): RRStanding[] {
  const table = new Map<string, RRStanding>();
  const row = (id: string): RRStanding => {
    let s = table.get(id);
    if (!s) {
      s = { teamId: id, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0 };
      table.set(id, s);
    }
    return s;
  };

  for (const m of matches) {
    if (!m.homeTeamId || !m.awayTeamId) continue;
    // Register every scheduled team so a winless team still appears.
    row(m.homeTeamId);
    row(m.awayTeamId);
    if (m.status !== "COMPLETED" || !m.winnerTeamId) continue;

    const h = row(m.homeTeamId);
    const a = row(m.awayTeamId);
    h.played++; a.played++;
    if (m.homeScore != null && m.awayScore != null) {
      h.pointsFor += m.homeScore; h.pointsAgainst += m.awayScore;
      a.pointsFor += m.awayScore; a.pointsAgainst += m.homeScore;
    }
    if (m.winnerTeamId === m.homeTeamId) { h.wins++; a.losses++; }
    else { a.wins++; h.losses++; }
  }

  for (const s of table.values()) s.diff = s.pointsFor - s.pointsAgainst;

  return [...table.values()].sort(
    (x, y) => y.wins - x.wins || y.diff - x.diff || y.pointsFor - x.pointsFor,
  );
}
