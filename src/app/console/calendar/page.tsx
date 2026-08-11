import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { SEASON_WEEKS, weekStatus, DIVISION_MIN_TEAMS, type WeekKind } from "@/lib/domain/seasonCalendar";

export const dynamic = "force-dynamic";

const KIND_META: Record<WeekKind, { label: string; dot: string; ring: string }> = {
  practice: { label: "Practice", dot: "bg-brand-500", ring: "ring-brand-200" },
  league: { label: "League", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  break: { label: "Break", dot: "bg-slate-400", ring: "ring-slate-200" },
  championship: { label: "Championship", dot: "bg-amber-500", ring: "ring-amber-200" },
};

function fmtRange(aISO: string, bISO: string) {
  const a = new Date(`${aISO}T12:00:00Z`);
  const b = new Date(`${bISO}T12:00:00Z`);
  const mo = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${mo(a)} ${a.getUTCDate()}–${b.getUTCDate()}`
    : `${mo(a)} ${a.getUTCDate()} – ${mo(b)} ${b.getUTCDate()}`;
}

export default async function SeasonCalendarPage() {
  const now = new Date();

  // Division readiness works off the active ACP league season if there is one,
  // otherwise the active PURE Academy season.
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "ACP" } })) ??
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } }));

  const divisions = season
    ? await prisma.division.findMany({
        where: { seasonId: season.id, divisionType: { not: "LESSON" } },
        include: { _count: { select: { teams: true } } },
        orderBy: [{ divisionType: "asc" }, { minRating: "asc" }, { name: "asc" }],
      })
    : [];
  const youth = divisions.filter((d) => d.divisionType === "SCHOOL_LEVEL");
  const adult = divisions.filter((d) => d.divisionType !== "SCHOOL_LEVEL");

  const current = SEASON_WEEKS.find((w) => weekStatus(w, now) === "current");
  const firstWeek = SEASON_WEEKS[0];
  const seasonNotStarted = weekStatus(firstWeek, now) === "upcoming";

  return (
    <div className="space-y-6">
      <PageHeader title="Season calendar" subtitle="The twelve-week arc: six practice weeks, five ACP league weeks, and championship week — with the two dark weeks built in." />

      {/* Where we are */}
      <div className="card border-l-4 border-brand-500">
        {current ? (
          <p className="text-sm text-slate-700">
            You&apos;re in <span className="font-semibold text-slate-900">{current.week ? `Week ${current.week}` : "the Thanksgiving break"}</span>
            {current.week ? <> — <span className="text-slate-600">{current.focus}</span></> : null}
          </p>
        ) : seasonNotStarted ? (
          <p className="text-sm text-slate-700">
            The season starts <span className="font-semibold text-slate-900">{fmtRange(firstWeek.startISO, firstWeek.endISO)}</span> with Week 1 — foundations and team formation.
          </p>
        ) : (
          <p className="text-sm text-slate-700">The season is complete. 🎉</p>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          {(["practice", "league", "championship", "break"] as WeekKind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${KIND_META[k].dot}`} />
              {KIND_META[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* The 12-week arc */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2 pr-2">Week</th>
              <th className="pr-2">Dates</th>
              <th className="pr-2">Primary focus</th>
              <th>Milestone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {SEASON_WEEKS.map((w) => {
              const status = weekStatus(w, now);
              const meta = KIND_META[w.kind];
              return (
                <tr
                  key={`${w.startISO}`}
                  className={
                    status === "current"
                      ? `ring-1 ${meta.ring} bg-brand-50/40`
                      : status === "past"
                      ? "text-slate-400"
                      : w.kind === "break"
                      ? "bg-slate-50/60"
                      : ""
                  }
                >
                  <td className="py-2.5 pr-2">
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                      <span className="font-semibold text-slate-700">{w.week ?? "—"}</span>
                      {status === "current" && <span className="badge bg-brand-100 text-brand-800">now</span>}
                    </span>
                  </td>
                  <td className="pr-2 whitespace-nowrap text-slate-600">{fmtRange(w.startISO, w.endISO)}</td>
                  <td className={`pr-2 ${w.kind === "break" ? "font-medium text-slate-600" : "text-slate-700"}`}>{w.focus}</td>
                  <td className="text-slate-600">
                    {w.milestone ? <span className="badge bg-accent-100 text-accent-800">{w.milestone}</span> : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <Link href="/console/schedule" className="text-brand-600 hover:underline">Practice schedule →</Link>
          <Link href="/console/league" className="text-brand-600 hover:underline">League matches →</Link>
          <Link href="/console/championship" className="text-brand-600 hover:underline">Championship →</Link>
        </div>
      </div>

      {/* Division readiness — the four-team minimum */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">Division readiness</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {season ? <>{season.name} · </> : null}
              A division runs with at least {DIVISION_MIN_TEAMS} teams. Short divisions are consolidated with an adjacent
              band rather than cancelled, so every team has a season.
            </p>
          </div>
          <Link href="/console/setup" className="btn-secondary text-sm">Manage divisions →</Link>
        </div>

        {divisions.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            No divisions yet. Add them in <Link href="/console/setup" className="text-brand-700 underline">Season Setup</Link>.
          </p>
        ) : (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <DivisionSystem title="Youth — by school level" divisions={youth} />
            <DivisionSystem title="Adult — by DUPR band" divisions={adult} />
          </div>
        )}
      </div>
    </div>
  );
}

function DivisionSystem({
  title,
  divisions,
}: {
  title: string;
  divisions: { id: string; name: string; _count: { teams: number } }[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {divisions.length === 0 ? (
        <p className="text-sm text-slate-400">No divisions in this system.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-100">
          {divisions.map((d) => {
            const n = d._count.teams;
            const meets = n >= DIVISION_MIN_TEAMS;
            return (
              <li key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{d.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{n} team{n === 1 ? "" : "s"}</span>
                  {meets ? (
                    <span className="badge bg-emerald-100 text-emerald-800">runs</span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-800" title={`Fewer than ${DIVISION_MIN_TEAMS} teams — consolidate with an adjacent band`}>
                      short · consolidate
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
