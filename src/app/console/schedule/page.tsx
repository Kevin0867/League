import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTime12, formatTimeRange12, formatDate } from "@/lib/time";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice",
  LEAGUE_MATCH: "League",
  CHAMPIONSHIP: "Championship",
  ALA_CARTE: "Private Lessons",
};

const OK_LABEL: Record<string, string> = {
  generate: "Practice schedule generated.",
  added: "Practice added — the team has been notified.",
};

const ERR_LABEL: Record<string, string> = {
  auth: "Not authorized to manage scheduling.",
  team: "Team not found.",
  config: "Set the team's day, time, and facility before generating a schedule.",
  exists: "This team already has a practice schedule.",
  adddate: "Pick a valid date for the practice.",
  op: "Unknown action.",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ok, err, view, month, team } = await searchParams;
  const ticket = await mintConsoleTicket();
  const isCalendar = view === "calendar";
  const teamFilter = team && team !== "all" ? team : null;
  const now = new Date();
  const [calYear, calMonth] = (() => {
    const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
    if (m) return [Number(m[1]), Number(m[2]) - 1];
    return [now.getUTCFullYear(), now.getUTCMonth()];
  })();
  const [sessions, teams, facilities] = await Promise.all([
    prisma.session.findMany({
      include: { facility: true, teams: { include: { team: true } } },
      orderBy: { date: "asc" },
      take: 200,
    }),
    prisma.team.findMany({
      where: { origin: "PURE_ACADEMY" },
      include: { _count: { select: { sessions: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Teams ready to generate: have day/time/facility but no sessions yet.
  const ungenerated = teams.filter(
    (t) => t.dayOfWeek && t.startTime && t.facilityId && t._count.sessions === 0
  );

  // Team filter — clicking a team shows only that team's sessions.
  const teamsWithSessions = teams
    .filter((t) => t._count.sessions > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedTeam = teamFilter ? teams.find((t) => t.id === teamFilter) ?? null : null;
  const visibleSessions = teamFilter
    ? sessions.filter((s) => s.teams.some((st) => st.teamId === teamFilter))
    : sessions;
  // Preserve the calendar/list view when switching the team filter.
  const filterHref = (teamId: string | null) => {
    const qs = new URLSearchParams();
    if (isCalendar) qs.set("view", "calendar");
    if (teamId) qs.set("team", teamId);
    const s = qs.toString();
    return `/console/schedule${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Schedule" subtitle="The twelve-session season: six practice weeks, five league weeks, championship week." />
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-sm">
            <Link href={teamFilter ? `/console/schedule?team=${teamFilter}` : "/console/schedule"} className={`px-3 py-1.5 ${!isCalendar ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>List</Link>
            <Link href={teamFilter ? `/console/schedule?view=calendar&team=${teamFilter}` : "/console/schedule?view=calendar"} className={`px-3 py-1.5 ${isCalendar ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Calendar</Link>
          </div>
          <PrintButton label="Print" />
        </div>
      </div>

      {ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{OK_LABEL[ok] ?? "Done."}</div>
      )}
      {err && (
        <div className="rounded-lg border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{ERR_LABEL[err] ?? "Something went wrong — please try again, and contact us if it persists."}</div>
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

      {/* Add a single practice (make-up or extra) — notifies the team */}
      {teams.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold text-slate-900">Add a practice</summary>
          <p className="mt-1 text-sm text-slate-500">
            A one-off practice — a make-up or an extra session. Time and location default to the team&apos;s, and the
            team is notified unless you turn that off.
          </p>
          <form method="POST" action="/api/console/schedule" className="mt-3 grid gap-3 sm:grid-cols-6 sm:items-end">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="addSession" />
            <input type="hidden" name="returnTo" value="/console/schedule" />
            <div className="sm:col-span-2">
              <label className="label">Team</label>
              <select name="teamId" className="input" required>
                <option value="">— choose team —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date</label>
              <input name="date" type="date" className="input" required />
            </div>
            <div>
              <label className="label">Start</label>
              <input name="startTime" type="time" className="input" />
            </div>
            <div>
              <label className="label">End</label>
              <input name="endTime" type="time" className="input" />
            </div>
            <div className="sm:col-span-3">
              <label className="label">Facility</label>
              <select name="facilityId" className="input">
                <option value="">Team&apos;s facility</option>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
              <input type="checkbox" name="notify" value="1" defaultChecked />
              Notify the team
            </label>
            <div className="sm:col-span-1">
              <button className="btn-primary w-full">Add practice</button>
            </div>
          </form>
        </details>
      )}

      {/* Team filter — view one team's schedule, or all */}
      {teamsWithSessions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Team</span>
          <Link
            href={filterHref(null)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${!teamFilter ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            All teams
          </Link>
          {teamsWithSessions.map((t) => (
            <Link
              key={t.id}
              href={filterHref(t.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${teamFilter === t.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      {selectedTeam && (
        <p className="text-sm text-slate-600">
          Showing <span className="font-semibold text-slate-800">{selectedTeam.name}</span>&apos;s schedule ·{" "}
          <Link href={filterHref(null)} className="text-brand-600 hover:underline">show all teams</Link>
        </p>
      )}

      {isCalendar ? (
        <ScheduleCalendar
          year={calYear}
          month={calMonth}
          sessions={visibleSessions.map((s) => ({
            id: s.id,
            date: s.date,
            startTime: s.startTime,
            type: s.type,
            teamNames: s.teams.map((t) => t.team.name).join(", "),
            facilityName: s.facility?.name ?? "",
          }))}
        />
      ) : (
      <div className="card overflow-x-auto print-area">
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
            {visibleSessions.map((s) => (
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
            {visibleSessions.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-slate-400">{teamFilter ? "No sessions for this team yet." : "No sessions scheduled yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
