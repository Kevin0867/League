import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice",
  LEAGUE_MATCH: "League",
  CHAMPIONSHIP: "Championship",
  ALA_CARTE: "À la carte",
};

export default async function SchedulePage() {
  const sessions = await prisma.session.findMany({
    include: {
      facility: true,
      teams: { include: { team: true } },
    },
    orderBy: { date: "asc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule" subtitle="The twelve-session season: six practice weeks, five league weeks, championship week." />
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="py-2 text-slate-700">{s.date.toLocaleDateString()}</td>
                <td className="text-slate-500">{s.weekNumber ?? "—"}</td>
                <td className="text-slate-600">{TYPE_LABEL[s.type] ?? s.type}</td>
                <td className="text-slate-600">{s.teams.map((t) => t.team.name).join(", ") || "—"}</td>
                <td className="text-slate-600">{s.facility?.name ?? "—"}</td>
                <td className="text-slate-500">{s.startTime}–{s.endTime}</td>
                <td><StatusBadge status={s.status} /></td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">No sessions scheduled yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
