import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { getSeasonWeeks, weekStatus, DIVISION_MIN_TEAMS, type WeekKind, type WeekPlan, type WeekStatus } from "@/lib/domain/seasonCalendar";
import { ConsolidateDivisions } from "./ConsolidateDivisions";

export const dynamic = "force-dynamic";

const OK_MSG: Record<string, string> = {
  consolidateDivisions: "Divisions consolidated.",
  initSeasonCalendar: "Calendar is now editable — tweak any week below.",
  resetSeasonCalendar: "Calendar reset to the standard template.",
  editSeasonWeek: "Week updated.",
  shiftSeasonCalendar: "Whole calendar shifted to the new start date.",
};
const ERR_MSG: Record<string, string> = {
  auth: "You are not authorized to make that change.",
  consolidatefields: "Pick both a source and a target division.",
  consolidatesame: "Pick two different divisions.",
  consolidateseason: "Divisions must be in the same season.",
  season: "A season is required.",
  notfound: "Not found.",
};

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

export default async function SeasonCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const session = await getSession();
  const admin = session ? isAdmin(session.role) : false;
  const ticket = await mintConsoleTicket();

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

  // The arc: the season's edited calendar if it has one, else the template.
  const arcWeeks = getSeasonWeeks(season?.calendar);
  const calendarEditable = Array.isArray(season?.calendar);
  const current = arcWeeks.find((w) => weekStatus(w, now) === "current");
  const firstWeek = arcWeeks[0];
  const seasonNotStarted = firstWeek ? weekStatus(firstWeek, now) === "upcoming" : false;

  return (
    <div className="space-y-6">
      <PageHeader title="Season calendar" subtitle="The twelve-week arc: six practice weeks, five ACP league weeks, and championship week — with the two dark weeks built in." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">{OK_MSG[sp.ok] ?? "Done."}</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{ERR_MSG[sp.err] ?? "Something went wrong."}</div>}

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

      {/* The 12-week arc — inline-editable per week for admins */}
      <div className="card">
        {/* Master date control: shift the whole arc by setting Week 1's start. */}
        {admin && season && arcWeeks.length > 0 && (
          <form method="POST" action="/api/console/setup" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="shiftSeasonCalendar" />
            <input type="hidden" name="seasonId" value={season.id} />
            <input type="hidden" name="returnTo" value="/console/calendar" />
            <div>
              <label className="label">Season start (Week 1 Monday)</label>
              <input name="startDate" type="date" defaultValue={arcWeeks[0].startISO} className="input text-sm" />
            </div>
            <button className="btn-secondary text-sm">Shift whole calendar</button>
            <p className="text-xs text-slate-500">Moves all 12 weeks together, keeping each week&apos;s focus &amp; milestone. Fine-tune any single week below.</p>
          </form>
        )}

        {/* Column header */}
        <div className={`hidden gap-2 px-2 pb-2 text-xs uppercase tracking-wide text-slate-400 sm:grid ${admin ? "sm:grid-cols-[3.5rem_9rem_1fr_10rem_5rem]" : "sm:grid-cols-[3.5rem_9rem_1fr_10rem]"}`}>
          <div>Week</div><div>Dates</div><div>Primary focus</div><div>Milestone</div>{admin && <div>Edit</div>}
        </div>

        <div className="rounded-lg ring-1 ring-slate-100">
          {arcWeeks.map((w, i) => (
            <WeekRow key={`${w.startISO}-${i}`} w={w} status={weekStatus(w, now)} admin={admin && !!season} ticket={ticket} seasonId={season?.id ?? ""} index={i} />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <Link href="/console/schedule" className="text-brand-600 hover:underline">Practice schedule →</Link>
          <Link href="/console/league" className="text-brand-600 hover:underline">League matches →</Link>
          <Link href="/console/championship" className="text-brand-600 hover:underline">Championship →</Link>
          {admin && season && calendarEditable && (
            <form method="POST" action="/api/console/setup" className="ml-auto">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="resetSeasonCalendar" />
              <input type="hidden" name="seasonId" value={season.id} />
              <input type="hidden" name="returnTo" value="/console/calendar" />
              <button className="text-rose-600 hover:underline">Reset to the standard template</button>
            </form>
          )}
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
            <DivisionSystem title="Youth — by school level" divisions={youth} admin={admin} ticket={ticket} />
            <DivisionSystem title="Adult — by DUPR band" divisions={adult} admin={admin} ticket={ticket} />
          </div>
        )}
      </div>
    </div>
  );
}

// One week of the arc. Read-only for coaches; for admins it's a disclosure whose
// summary is the week row and whose body is the inline edit form — so editing
// happens right next to the week, not in a separate view.
function WeekRow({
  w,
  status,
  admin,
  ticket,
  seasonId,
  index,
}: {
  w: WeekPlan;
  status: WeekStatus;
  admin: boolean;
  ticket: string;
  seasonId: string;
  index: number;
}) {
  const meta = KIND_META[w.kind];
  const cols = admin ? "sm:grid-cols-[3.5rem_9rem_1fr_10rem_5rem]" : "sm:grid-cols-[3.5rem_9rem_1fr_10rem]";
  const rowTone =
    status === "current" ? `bg-brand-50/50 ${meta.ring} ring-1` : status === "past" ? "text-slate-400" : w.kind === "break" ? "bg-slate-50/60" : "";

  const summary = (
    <div className={`grid grid-cols-1 items-center gap-1 px-3 py-2.5 sm:gap-2 ${cols} ${rowTone}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <span className="font-semibold text-slate-700">{w.week ?? "—"}</span>
        {status === "current" && <span className="badge bg-brand-100 text-brand-800">now</span>}
      </div>
      <div className="whitespace-nowrap text-slate-600">{fmtRange(w.startISO, w.endISO)}</div>
      <div className={w.kind === "break" ? "font-medium text-slate-600" : "text-slate-700"}>{w.focus}</div>
      <div>{w.milestone ? <span className="badge bg-accent-100 text-accent-800">{w.milestone}</span> : <span className="text-slate-300">—</span>}</div>
      {admin && (
        <div className="text-xs font-semibold text-brand-700">
          <span className="group-open:hidden">✎ Edit</span>
          <span className="hidden text-slate-500 group-open:inline">Close ▲</span>
        </div>
      )}
    </div>
  );

  if (!admin) return <div className="border-b border-slate-100 last:border-0">{summary}</div>;

  return (
    <details className="group border-b border-slate-100 last:border-0">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{summary}</summary>
      <div className="bg-slate-50/70 px-3 pb-3 pt-1">
        <EditWeekForm ticket={ticket} seasonId={seasonId} index={index} week={w} />
      </div>
    </details>
  );
}

function EditWeekForm({
  ticket,
  seasonId,
  index,
  week,
}: {
  ticket: string;
  seasonId: string;
  index: number;
  week: WeekPlan;
}) {
  return (
    <form method="POST" action="/api/console/setup" className="grid gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-100 sm:grid-cols-12 sm:items-end">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="editSeasonWeek" />
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="index" value={index} />
      <input type="hidden" name="returnTo" value="/console/calendar" />
      <div className="sm:col-span-1">
        <label className="label">Wk</label>
        <div className="pt-1.5 text-sm font-semibold text-slate-600">{week.week ?? "—"}</div>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Start</label>
        <input name="startDate" type="date" defaultValue={week.startISO} className="input text-sm" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">End</label>
        <input name="endDate" type="date" defaultValue={week.endISO} className="input text-sm" />
      </div>
      <div className="sm:col-span-4">
        <label className="label">Focus</label>
        <input name="focus" type="text" defaultValue={week.focus} className="input text-sm" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Milestone</label>
        <input name="milestone" type="text" defaultValue={week.milestone ?? ""} className="input text-sm" placeholder="—" />
      </div>
      <div className="sm:col-span-1">
        <button className="btn-secondary w-full text-xs">Save</button>
      </div>
    </form>
  );
}

function DivisionSystem({
  title,
  divisions,
  admin,
  ticket,
}: {
  title: string;
  divisions: { id: string; name: string; _count: { teams: number } }[];
  admin: boolean;
  ticket: string;
}) {
  const shortCount = divisions.filter((d) => d._count.teams < DIVISION_MIN_TEAMS).length;
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
      {admin && divisions.length >= 2 && (
        <>
          {shortCount > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              {shortCount} division{shortCount === 1 ? "" : "s"} below {DIVISION_MIN_TEAMS} teams — consolidate a short band into an adjacent one.
            </p>
          )}
          <ConsolidateDivisions
            ticket={ticket}
            divisions={divisions.map((d) => ({ id: d.id, name: d.name, teams: d._count.teams }))}
          />
        </>
      )}
    </div>
  );
}
