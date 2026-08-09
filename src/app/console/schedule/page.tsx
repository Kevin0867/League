import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { generateSchedule } from "./actions";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice",
  LEAGUE_MATCH: "League",
  CHAMPIONSHIP: "Championship",
  ALA_CARTE: "À la carte",
};

export default async function SchedulePage() {
  const [sessions, teams] = await Promise.all([
    prisma.session.findMany({
      include: { facility: true, teams: { include: { team: true } } },
      orderBy: { date: "asc" },
      take: 200,
    }),
    prisma.team.findMany({
      where: { origin: "PURE_ACADEMY" },
      include: { _count: { select: { sessions: true } } },
    }),
  ]);

  // Teams ready to generate: have day/time/facility but no sessions yet.
  const ungenerated = teams.filter(
    (t) => t.dayOfWeek && t.startTime && t.facilityId && t._count.sessions === 0
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule" subtitle="The twelve-session season: six practice weeks, five league weeks, championship week." />

      {ungenerated.length > 0 && (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-900">Generate practice season</h2>
          <p className="mb-3 text-sm text-slate-500">
            Six weekly practices from the season start, skipping blackout weeks (Thanksgiving is dark).
          </p>
          <div className="flex flex-wrap gap-2">
            {ungenerated.map((t) => (
              <form key={t.id} action={generateSchedule}>
                <input type="hidden" name="teamId" value={t.id} />
                <button className="btn-secondary text-sm">
                  Generate · {t.name} ({t.dayOfWeek} {t.startTime})
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Date</th>
              <th>Wk</th>
              <th>Type</th>
              <th>Team(s)</th>
              <th>Facility</th>
              <th>Time</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="py-2 text-slate-700">{s.date.toLocaleDateString()}</td>
                <td className="text-slate-500">{s.weekNumber ?? "—"}</td>
                <td className="text-slate-600">{TYPE_LABEL[s.type] ?? s.type}</td>
                <td className="text-slate-600">{s.teams.map((t) => t.team.name).join(", ") || "—"}</td>
                <td className="text-slate-600">{s.facility?.name ?? "—"}</td>
                <td className="text-slate-500">{s.startTime}–{s.endTime}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="text-right">
                  <Link href={`/console/schedule/${s.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                    open →
                  </Link>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-slate-400">No sessions scheduled yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
