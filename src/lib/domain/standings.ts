// Standings computation (§12). The method isn't finalized (matches won, lines
// won, games won, or points differential), so we store results at game level
// and compute standings here — any method can be swapped in without re-entry.
// Forfeits are recorded 3–0 in the standings but NEVER submitted to DUPR.

export type GameResult = { homeScore: number; awayScore: number; isCounting: boolean };
export type LineResult = { lineNumber: number; games: GameResult[]; isCounting: boolean };

export type FixtureResult = {
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: string; // SCHEDULED | COMPLETED | FORFEITED ...
  forfeitedById: string | null;
  lines: LineResult[];
};

export type TeamStanding = {
  teamId: string;
  played: number;
  matchesWon: number;
  matchesLost: number;
  linesWon: number;
  linesLost: number;
  gamesWon: number;
  gamesLost: number;
  forfeits: number;
  points: number; // matches won (default method) — tiebreakers layered on
};

function winnerOfLine(line: LineResult): "HOME" | "AWAY" | null {
  let h = 0;
  let a = 0;
  for (const g of line.games) {
    if (g.homeScore > g.awayScore) h++;
    else if (g.awayScore > g.homeScore) a++;
  }
  if (h >= 2) return "HOME";
  if (a >= 2) return "AWAY";
  return null;
}

function blank(teamId: string): TeamStanding {
  return {
    teamId, played: 0, matchesWon: 0, matchesLost: 0, linesWon: 0, linesLost: 0,
    gamesWon: 0, gamesLost: 0, forfeits: 0, points: 0,
  };
}

export function computeStandings(fixtures: FixtureResult[]): TeamStanding[] {
  const table = new Map<string, TeamStanding>();
  const get = (id: string) => {
    if (!table.has(id)) table.set(id, blank(id));
    return table.get(id)!;
  };

  for (const fx of fixtures) {
    if (!fx.homeTeamId || !fx.awayTeamId) continue;
    const home = get(fx.homeTeamId);
    const away = get(fx.awayTeamId);

    if (fx.status === "FORFEITED") {
      // 3–0 to the non-forfeiting team; excluded from DUPR upstream.
      const loser = fx.forfeitedById;
      const winnerTeam = loser === fx.homeTeamId ? away : home;
      const loserTeam = loser === fx.homeTeamId ? home : away;
      winnerTeam.played++; loserTeam.played++;
      winnerTeam.matchesWon++; loserTeam.matchesLost++;
      winnerTeam.linesWon += 3; loserTeam.linesLost += 3;
      winnerTeam.points += 1;
      loserTeam.forfeits++;
      continue;
    }
    if (fx.status !== "COMPLETED") continue;

    home.played++; away.played++;
    let homeLines = 0;
    let awayLines = 0;
    for (const line of fx.lines) {
      // Count games for both counting and exhibition lines in game tallies,
      // but only counting lines decide the match.
      for (const g of line.games) {
        if (g.homeScore > g.awayScore) { home.gamesWon++; away.gamesLost++; }
        else if (g.awayScore > g.homeScore) { away.gamesWon++; home.gamesLost++; }
      }
      if (!line.isCounting) continue;
      const w = winnerOfLine(line);
      if (w === "HOME") { home.linesWon++; away.linesLost++; homeLines++; }
      else if (w === "AWAY") { away.linesWon++; home.linesLost++; awayLines++; }
    }
    if (homeLines > awayLines) { home.matchesWon++; away.matchesLost++; home.points += 1; }
    else if (awayLines > homeLines) { away.matchesWon++; home.matchesLost++; away.points += 1; }
  }

  return [...table.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.linesWon - a.linesWon ||
      b.gamesWon - a.gamesWon ||
      (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost)
  );
}
