import { PublicNav } from "@/components/PublicNav";
import { prisma } from "@/lib/db";
import { computeStandings, type FixtureResult } from "@/lib/domain/standings";

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const divisions = await prisma.division.findMany({
    include: {
      teams: true,
      season: true,
    },
    orderBy: { name: "asc" },
  });

  const fixtures = await prisma.fixture.findMany({
    include: { lines: { include: { games: true } } },
  });

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
  const standingByTeam = new Map(standings.map((s) => [s.teamId, s]));

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">League standings</h1>
        <p className="mt-2 text-slate-600">
          Arizona Club Pickleball, by division. Forfeits are recorded 3–0 and never
          submitted to DUPR.
        </p>

        <div className="mt-8 space-y-8">
          {divisions.filter((d) => d.teams.length > 0).map((d) => (
            <section key={d.id} className="card">
              <h2 className="mb-3 font-semibold text-slate-900">{d.name}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="py-1">Team</th><th>P</th><th>W</th><th>L</th><th>Lines</th><th>Games</th><th>FF</th><th>Pts</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.teams
                      .map((t) => ({ t, s: standingByTeam.get(t.id) }))
                      .sort((a, b) => (b.s?.points ?? 0) - (a.s?.points ?? 0))
                      .map(({ t, s }) => (
                        <tr key={t.id}>
                          <td className="py-1.5 font-medium text-slate-800">{t.name}</td>
                          <td>{s?.played ?? 0}</td>
                          <td>{s?.matchesWon ?? 0}</td>
                          <td>{s?.matchesLost ?? 0}</td>
                          <td>{s?.linesWon ?? 0}–{s?.linesLost ?? 0}</td>
                          <td>{s?.gamesWon ?? 0}–{s?.gamesLost ?? 0}</td>
                          <td className={s && s.forfeits > 0 ? "text-rose-600 font-medium" : ""}>{s?.forfeits ?? 0}</td>
                          <td className="font-bold text-slate-900">{s?.points ?? 0}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {divisions.filter((d) => d.teams.length > 0).length === 0 && (
            <p className="text-slate-500">Standings will appear once league play begins.</p>
          )}
        </div>
      </div>
    </div>
  );
}
