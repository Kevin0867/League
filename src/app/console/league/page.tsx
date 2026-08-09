import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { generateFixtures, sendMatchNotice, sendEscalationAlert } from "./actions";
import { teamConfirmation, shouldEscalate, MIN_CONFIRMED_PLAYERS } from "@/lib/domain/availability";

export const dynamic = "force-dynamic";

export default async function LeaguePage() {
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });

  const fixtures = await prisma.fixture.findMany({
    where: season ? { seasonId: season.id } : {},
    include: {
      homeTeam: { include: { members: true, division: true } },
      awayTeam: { include: { members: true } },
      facility: true,
      confirmations: true,
    },
    orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
    take: 200,
  });

  const now = new Date();
  const totalTeams = await prisma.team.count({ where: season ? { seasonId: season.id } : {} });

  // Confirmation status per fixture (for the current/near window).
  const withStatus = fixtures.map((f) => {
    const teams = [f.homeTeam, f.awayTeam].filter(Boolean).map((team) => {
      const statuses = team!.members.map(
        (m) => f.confirmations.find((c) => c.personId === m.personId)?.status ?? "UNCONFIRMED"
      );
      const tc = teamConfirmation(team!.id, team!.name, team!.members.length, statuses);
      return { ...tc, atRisk: shouldEscalate(f.scheduledAt, now, tc) };
    });
    return { fixture: f, teams, anyRisk: teams.some((t) => t.atRisk) };
  });

  const upcoming = withStatus.filter(
    (w) => w.fixture.scheduledAt.getTime() > now.getTime() - 6 * 3.6e6 &&
      ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(w.fixture.status)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="ACP League" subtitle="Doubles-only, three ranked lines, DUPR-recorded. Fixtures across five league weeks; 48-hour confirmation with escalation." />

      {/* Generate fixtures */}
      {season && fixtures.length === 0 && (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-900">Generate fixtures</h2>
          <p className="mb-3 text-sm text-slate-500">
            Round-robin across five league weeks from {season.startDate.toLocaleDateString()}, skipping
            blackout weeks and the Dec 5–6 weekend. {totalTeams} team(s) in the season.
          </p>
          <form action={generateFixtures}>
            <input type="hidden" name="seasonId" value={season.id} />
            <button className="btn-primary">Generate fixtures</button>
          </form>
        </div>
      )}

      {/* 48-hour confirmation dashboard */}
      {upcoming.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Confirmation dashboard</h2>
          <p className="mb-3 text-sm text-slate-500">
            Every fixture&apos;s confirmed players. A team below {MIN_CONFIRMED_PLAYERS} confirmed inside 48
            hours is at risk of forfeit — alert the coach, Director, and COO.
          </p>
          <div className="space-y-3">
            {upcoming.map(({ fixture: f, teams, anyRisk }) => (
              <div key={f.id} className={`rounded-lg border p-3 ${anyRisk ? "border-rose-300 bg-rose-50/40" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{f.homeTeam?.name} vs {f.awayTeam?.name}</span>
                    <span className="ml-2 text-xs text-slate-400">Wk {f.weekNumber} · {f.scheduledAt.toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <form action={sendMatchNotice}>
                      <input type="hidden" name="fixtureId" value={f.id} />
                      <button className="btn-ghost text-xs">Send 7-day notice</button>
                    </form>
                    {anyRisk && (
                      <form action={sendEscalationAlert}>
                        <input type="hidden" name="fixtureId" value={f.id} />
                        <button className="btn-secondary text-xs text-rose-700 ring-rose-200 hover:bg-rose-50">Send 48h alert</button>
                      </form>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {teams.map((t) => (
                    <div key={t.teamId} className="flex items-center justify-between rounded bg-white px-3 py-2 text-sm ring-1 ring-slate-100">
                      <span className="text-slate-700">{t.teamName}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className={t.enough ? "text-emerald-700" : "text-rose-700 font-medium"}>
                          {t.confirmedPlaying}/{MIN_CONFIRMED_PLAYERS} playing
                        </span>
                        <span className="text-slate-400">{t.unconfirmed} unconfirmed</span>
                        {t.atRisk && <span className="badge bg-rose-100 text-rose-800">at risk</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All fixtures */}
      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold text-slate-900">Fixtures</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr><th className="py-2">Wk</th><th>Date</th><th>Home</th><th>Away</th><th>Hub</th><th>Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fixtures.map((f) => (
              <tr key={f.id}>
                <td className="py-2 text-slate-500">{f.weekNumber}</td>
                <td className="text-slate-700">{f.scheduledAt.toLocaleDateString()}</td>
                <td className="text-slate-700">{f.homeTeam?.name ?? "TBD"}</td>
                <td className="text-slate-700">{f.awayTeam?.name ?? "TBD"}</td>
                <td className="text-slate-600">{f.facility?.name ?? "—"}</td>
                <td><StatusBadge status={f.status} /></td>
              </tr>
            ))}
            {fixtures.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No fixtures generated yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
