// The flat league leaderboard — the single ladder behind the console League hub
// and the public standings page. Built on the same computeStandings() the
// championship bracket seeds from, so the ladder a coach sees and the seeds a
// bracket draws never diverge. Ranked over the explicit league roster
// (LeagueTeam), not grouped by division.
import { prisma } from "@/lib/db";
import { computeStandings, pointDiff, type FixtureResult, type TeamStanding } from "@/lib/domain/standings";

export type LeagueStandingRow = TeamStanding & { teamName: string };

function blankStanding(teamId: string): TeamStanding {
  return {
    teamId, played: 0, matchesWon: 0, matchesLost: 0, linesWon: 0, linesLost: 0,
    gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, forfeits: 0, points: 0,
  };
}

// Ranking: match points, then line differential, then point differential across
// counting lines, then lines won, then name. Line 4 never enters any of these
// (computeStandings drops it).
function rankRows(a: LeagueStandingRow, b: LeagueStandingRow): number {
  return (
    b.points - a.points ||
    (b.linesWon - b.linesLost) - (a.linesWon - a.linesLost) ||
    pointDiff(b) - pointDiff(a) ||
    b.linesWon - a.linesWon ||
    a.teamName.localeCompare(b.teamName)
  );
}

/// Flat league leaderboard over the explicit league roster (LeagueTeam).
/// Whichever published teams an admin added play a single round-robin and share
/// one leaderboard. Teams with no games yet appear at the bottom, 0 across.
export async function leagueStandingsFlat(seasonId: string): Promise<LeagueStandingRow[]> {
  const [entries, fixtures] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { seasonId },
      include: { team: { select: { id: true, name: true } } },
    }),
    prisma.fixture.findMany({
      where: { seasonId },
      include: { lines: { include: { games: true } } },
    }),
  ]);

  const names = new Map(entries.map((e) => [e.team.id, e.team.name]));

  const fixtureResults: FixtureResult[] = fixtures.map((f) => ({
    homeTeamId: f.homeTeamId,
    awayTeamId: f.awayTeamId,
    status: f.status,
    forfeitedById: f.forfeitedById,
    lines: f.lines.map((l) => ({
      lineNumber: l.lineNumber,
      isCounting: l.isCounting,
      games: l.games.map((g) => ({ homeScore: g.homeScore, awayScore: g.awayScore, isCounting: l.isCounting })),
    })),
  }));

  const standings = computeStandings(fixtureResults);
  const ranked = new Map(standings.map((s) => [s.teamId, s]));

  return entries
    .map((e) => ({
      ...(ranked.get(e.team.id) ?? blankStanding(e.team.id)),
      teamName: names.get(e.team.id) ?? "—",
    }))
    .sort(rankRows);
}
