import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTime12 } from "@/lib/time";
import {
  teamMissingFields,
  rosterStatus,
  canPublishTeam,
} from "@/lib/domain/teams";
import { TEAM_CAP, TEAM_MIN } from "@/lib/enums";
import { TeamCreateForm } from "./TeamCreateForm";
import { BulkScheduleEditor } from "./BulkScheduleEditor";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { TableFilter } from "@/components/TableFilter";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = { createTeam: "Team created.", deleteTeam: "Team deleted — players returned to the pool.", schedule: "Day, time, and facility saved. Generate practices on the Schedule page.", colors: "Team colors assigned — one distinct color per gender+level group." };
const ERRORS: Record<string, string> = {
  fields: "Team name and season are required.",
  auth: "You don't have permission to manage teams.",
  colorclash: "Another team in that division already uses that color — each team in a division needs a distinct color.",
};

export default async function TeamBuildBoard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const teams = await prisma.team.findMany({
    include: {
      _count: { select: { members: true } },
      coach: { include: { person: true } },
      facility: true,
      division: true,
      members: {
        include: { person: { select: { firstName: true, lastName: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });

  const seasonRows = await prisma.season.findMany({
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
    include: { divisions: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  const seasons = seasonRows.map((s) => ({ id: s.id, name: s.name, divisions: s.divisions }));
  const facilities = (await prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }));

  const ready = teams.filter((t) => teamMissingFields(t).length === 0).length;
  const published = teams.filter((t) => t.published).length;
  const buildingCount = teams.filter((t) => teamMissingFields(t).length > 0).length;
  const belowMin = teams.filter((t) => !rosterStatus(t._count.members, t.coachPlays).meetsMinimum).length;
  const readyToPublish = teams.filter((t) => canPublishTeam(t, t.facility).ok && !t.published).length;
  const allPublished = teams.length > 0 && teams.every((t) => t.published);

  // Steps use "every" semantics so the checklist reflects the true state of ALL
  // teams — not just whether at least one team reached each milestone.
  const steps = [
    { done: teams.length > 0, label: "Create your first team", href: null, cta: "Create a team below" },
    { done: teams.length > 0 && buildingCount === 0, label: "Complete each team (division, coach, facility, day/time)", href: null, cta: "" },
    { done: teams.length > 0 && belowMin === 0, label: `Fill every roster to the minimum (${TEAM_MIN})`, href: "/console/board", cta: "Assignment board" },
    { done: allPublished, label: "Publish ready teams to families", href: null, cta: "" },
  ];
  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team build board</h1>
          <p className="text-slate-500">
            Every team&apos;s six fields and completion status. Cap {TEAM_CAP}, minimum {TEAM_MIN}.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Pill label="Teams" value={teams.length} />
          <Pill label="Ready" value={ready} tone="emerald" />
          <Pill label="Published" value={published} tone="brand" />
        </div>
      </div>

      {sp.ok && OK[sp.ok] && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok]}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERRORS[sp.err] ?? "Something went wrong."}
        </p>
      )}

      {/* Guided next steps */}
      <div className="card border-l-4 border-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-900">Team build checklist</h2>
            {nextStep ? (
              <p className="mt-0.5 text-sm text-slate-600">Next: <span className="font-medium text-slate-800">{nextStep.label}</span></p>
            ) : (
              <p className="mt-0.5 text-sm text-emerald-700">Every team is complete and published. 🎉</p>
            )}
          </div>
          {readyToPublish > 0 && (
            <span className="badge bg-emerald-100 text-emerald-800">{readyToPublish} ready to publish</span>
          )}
        </div>
        <ol className="mt-3 space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{s.done ? "✓" : i + 1}</span>
              <span className={s.done ? "text-slate-500 line-through" : "text-slate-700"}>{s.label}</span>
              {!s.done && s.href && <Link href={s.href} className="text-xs text-accent-700 underline">{s.cta}</Link>}
            </li>
          ))}
        </ol>
      </div>

      <TeamCreateForm ticket={ticket} seasons={seasons} facilities={facilities} />

      {teams.length > 0 && (
        <BulkScheduleEditor
          ticket={ticket}
          facilities={facilities}
          teams={teams.map((t) => ({
            id: t.id,
            name: t.name,
            market: t.market,
            dayOfWeek: t.dayOfWeek,
            startTime: t.startTime,
            facilityId: t.facilityId,
          }))}
        />
      )}

      {teams.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Team colors</h2>
            <p className="text-sm text-slate-500">
              Give every team a distinct color within its gender+level group (e.g. one Women&apos;s 3.0 Red, one
              Blue). Assigns Red, Blue, Green, White, Black… in order per group and clears duplicates.
            </p>
          </div>
          <form method="POST" action="/api/console/teams">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="autoAssignColors" />
            <button className="btn-secondary text-sm">Auto-assign colors</button>
          </form>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="card">
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No teams yet. Create one above, then fill its roster by dragging players from the pools on the{" "}
            <Link href="/console/board" className="text-accent-700 underline">Assignment board</Link>.
          </p>
        </div>
      ) : (
        <>
        <div className="max-w-md">
          <TableFilter targetId="teams-grid" placeholder="Search teams by name, market, or division…" />
        </div>
        <div id="teams-grid" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const missing = teamMissingFields(t);
            const roster = rosterStatus(t._count.members, t.coachPlays);
            const publish = canPublishTeam(t, t.facility);
            return (
              <div key={t.id} data-filter-row data-filter-text={`${t.name} ${t.market ?? ""} ${t.divisionCode ?? ""} ${t.division?.name ?? ""} ${t.members.map((m) => `${m.person.firstName} ${m.person.lastName}`).join(" ")}`} className="card transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/console/teams/${t.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{t.name}</Link>
                    <p className="text-xs text-slate-400">
                      {t.origin === "ACP_CLUB" ? t.clubName ?? "Outside club" : "PURE Academy"}
                    </p>
                  </div>
                  {t.published ? (
                    <StatusBadge status="PUBLISHED" />
                  ) : missing.length === 0 ? (
                    <span className="badge bg-emerald-100 text-emerald-800">ready</span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-800">building</span>
                  )}
                </div>

                {/* Six fields */}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <Field label="Division" value={t.division?.name} />
                  <Field label="Level band" value={t.levelBand} />
                  <Field label="Market" value={t.market} />
                  <Field label="Coach" value={t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : t.origin === "ACP_CLUB" ? "n/a (contact)" : null} />
                  <Field label="Facility" value={t.facility?.name} />
                  <Field label="Day / time" value={t.dayOfWeek ? `${t.dayOfWeek} ${formatTime12(t.startTime)}`.trim() : null} />
                </dl>

                {/* Roster meter */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Roster {roster.effective}/{TEAM_CAP}{t.coachPlays ? " (coach plays)" : ""}</span>
                    <span>{roster.meetsMinimum ? "min met" : `need ${roster.needed}`}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full ${roster.meetsMinimum ? "bg-emerald-500" : "bg-amber-400"}`}
                      style={{ width: `${Math.min(100, (roster.effective / TEAM_CAP) * 100)}%` }}
                    />
                  </div>
                  {/* The players themselves, right on the card — no need to open
                      the team to see who's on it. */}
                  {t.members.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {t.members.map((m) => (
                        <li key={m.personId} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {m.person.firstName} {m.person.lastName}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">No players yet.</p>
                  )}
                </div>

                {/* Gates */}
                <div className="mt-3 space-y-1 text-xs">
                  {missing.length > 0 && (
                    <p className="text-amber-700">Missing: {missing.join(", ")}</p>
                  )}
                  {!publish.ok && (
                    <p className="text-slate-500">🔒 {publish.reason}</p>
                  )}
                  {publish.ok && !t.published && (
                    <p className="text-emerald-700">✓ Eligible to publish to families</p>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                  {publish.ok && !t.published ? (
                    <ConfirmSubmit
                      action="/api/console/teams"
                      fields={{ ticket, op: "publishTeam", teamId: t.id }}
                      confirm={`Publish "${t.name}" to families? It becomes visible to players and parents.`}
                      label="Publish to families"
                      className="btn-primary py-1 text-xs"
                    />
                  ) : (
                    <span />
                  )}
                  <Link href={`/console/teams/${t.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                    Manage team →
                  </Link>
                </div>
              </div>
            );
          })}
          <div data-filter-empty hidden className="card py-8 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">No teams match your search.</div>
        </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={value ? "font-medium text-slate-800" : "text-amber-600"}>
        {value ?? "— missing"}
      </dd>
    </div>
  );
}

function Pill({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" | "brand" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-800",
    brand: "bg-brand-100 text-brand-800",
  };
  return (
    <div className={`rounded-lg px-3 py-1.5 ${tones[tone]}`}>
      <span className="font-bold">{value}</span> <span className="text-xs">{label}</span>
    </div>
  );
}
