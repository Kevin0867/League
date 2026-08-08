import { prisma } from "@/lib/db";
import { PageHeader, RoadmapNote } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function LeaguePage() {
  const fixtures = await prisma.fixture.findMany({
    include: { homeTeam: true, awayTeam: true, facility: true },
    orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="ACP League" subtitle="Doubles-only, three ranked lines, DUPR-recorded. Fixtures across five league weeks." />

      <RoadmapNote phase="Phase 2">
        Match-night operations build on the data model already in place:
        7-day fixture notice, player-entered 48-hour availability confirmation with
        automatic escalation to coach + Director + COO, line-up submission with DUPR
        validation for non-PURE teams, line-by-line score entry, forfeit tracking, and a
        DUPR submission retry queue. Forfeited fixtures are excluded from DUPR by rule.
      </RoadmapNote>

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
