// Season-wide league standings, grouped by division — the leaderboard behind
// both the console League hub and the year-end tournament seeding. Built on the
// same computeStandings() the championship bracket seeds from, so the ladder a
// coach sees and the seeds a bracket draws never diverge.
import { prisma } from "@/lib/db";
import { computeStandings, type FixtureResult, type TeamStanding } from "@/lib/domain/standings";

export type DivisionStandings = {
  divisionId: string;
  divisionName: string;
  rows: Array<TeamStanding & { teamName: string }>;
};

export async function seasonStandingsByDivision(seasonId: string): Promise<DivisionStandings[]> {
  const divisions = await prisma.division.findMany({
    where: { seasonId },
    include: { teams: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const fixtures = await prisma.fixture.findMany({
    where: { seasonId },
    include: { lines: { include: { games: true } } },
  });

  return divisions
    .filter((d) => d.teams.length > 0)
    .map((d) => {
      const teamIds = new Set(d.teams.map((t) => t.id));
      const names = new Map(d.teams.map((t) => [t.id, t.name]));
      const divFixtures = fixtures.filter(
        (f) => (f.homeTeamId && teamIds.has(f.homeTeamId)) || (f.awayTeamId && teamIds.has(f.awayTeamId))
      );
      const fixtureResults: FixtureResult[] = divFixtures.map((f) => ({
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
      // Include teams with no games yet (they sort to the bottom, 0 across).
      const rows = d.teams
        .map((t) => ({
          ...(ranked.get(t.id) ?? {
            teamId: t.id, played: 0, matchesWon: 0, matchesLost: 0, linesWon: 0,
            linesLost: 0, gamesWon: 0, gamesLost: 0, forfeits: 0, points: 0,
          }),
          teamName: names.get(t.id) ?? "—",
        }))
        .sort(
          (a, b) =>
            b.points - a.points ||
            b.linesWon - a.linesWon ||
            b.gamesWon - a.gamesWon ||
            (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost) ||
            a.teamName.localeCompare(b.teamName)
        );
      return { divisionId: d.id, divisionName: d.name, rows };
    });
}
