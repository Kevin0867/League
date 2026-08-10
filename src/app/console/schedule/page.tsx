import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTime12, formatTimeRange12, formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice",
  LEAGUE_MATCH: "League",
  CHAMPIONSHIP: "Championship",
  ALA_CARTE: "À la carte",
};

const ERR_LABEL: Record<string, string> = {
  auth: "Not authorized to manage scheduling.",
  team: "Team not found.",
  config: "Set the team's day, time, and facility before generating a schedule.",
  exists: "This team already has a practice schedule.",
  op: "Unknown action.",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ok, err } = await searchParams;
  const ticket = await mintConsoleTicket();
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

      {ok === "generate" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Practice schedule generated.</div>
      )}
      {err && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{ERR_LABEL[err] ?? "Something went wrong."}</div>
      )}

      {ungenerated.length > 0 && (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-900">Generate practice season</h2>
          <p className="mb-3 text-sm text-slate-500">
            Six weekly practices from the season start, skipping blackout weeks (Thanksgiving is dark).
          </p>
          <div className="flex flex-wrap gap-2">
            {ungenerated.map((t) => (
              <form key={t.id} method="POST" action="/api/console/schedule">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="generate" />
                <input type="hidden" name="returnTo" value="/console/schedule" />
                <input type="hidden" name="teamId" value={t.id} />
                <button className="btn-secondary text-sm">
                  Generate · {t.name} ({t.dayOfWeek} {formatTime12(t.startTime)})
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
              <th className="hidden lg:table-cell">Wk</th>
              <th className="hidden md:table-cell">Type</th>
              <th className="hidden sm:table-cell">Team(s)</th>
              <th className="hidden md:table-cell">Facility</th>
              <th>Time</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="py-2 text-slate-700">{formatDate(s.date)}</td>
                <td className="hidden text-slate-500 lg:table-cell">{s.weekNumber ?? "—"}</td>
                <td className="hidden text-slate-600 md:table-cell">{TYPE_LABEL[s.type] ?? s.type}</td>
                <td className="hidden text-slate-600 sm:table-cell">{s.teams.map((t) => t.team.name).join(", ") || "—"}</td>
                <td className="hidden text-slate-600 md:table-cell">{s.facility?.name ?? "—"}</td>
                <td className="text-slate-500">{formatTimeRange12(s.startTime, s.endTime)}</td>
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
