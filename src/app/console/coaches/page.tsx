import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { coachAssignmentGate } from "@/lib/domain/teams";

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  const coaches = await prisma.coach.findMany({
    include: { person: true, _count: { select: { teams: true, recruits: true } } },
    orderBy: { person: { lastName: "asc" } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Coaches" subtitle="Screening gate, recruitment credit, and assignments." />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Coach</th>
              <th>Cert</th>
              <th>Screening</th>
              <th>Teams</th>
              <th>Recruited</th>
              <th>W-9</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {coaches.map((c) => {
              const gate = coachAssignmentGate(c);
              return (
                <tr key={c.id}>
                  <td className="py-2 font-medium text-slate-800">
                    {c.person.firstName} {c.person.lastName}
                    {c.isProCoach && <span className="ml-2 badge bg-brand-100 text-brand-800">Pro</span>}
                  </td>
                  <td className="text-slate-600">{c.rpoCertLevel ?? "—"}</td>
                  <td>
                    {gate.ok
                      ? <span className="badge bg-emerald-100 text-emerald-800">cleared</span>
                      : <span className="badge bg-amber-100 text-amber-800" title={gate.reasons.join(", ")}>{gate.reasons.length} issue{gate.reasons.length > 1 ? "s" : ""}</span>}
                  </td>
                  <td className="text-slate-600">{c._count.teams}</td>
                  <td className="text-slate-600">
                    {c._count.recruits}
                    <span className="ml-1 text-xs text-slate-400">credit{c._count.recruits === 1 ? "" : "s"}</span>
                  </td>
                  <td>{c.w9OnFile ? <span className="badge bg-emerald-100 text-emerald-800">on file</span> : <span className="badge bg-slate-100 text-slate-500">missing</span>}</td>
                </tr>
              );
            })}
            {coaches.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No coaches yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-500">
        Additional teams to a coach require a recruitment credit — earned by the
        registrations that came through them (§5).
      </p>
    </div>
  );
}
