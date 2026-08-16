import { DateField } from "@/components/DateField";
import { TimeSelect } from "@/components/TimeSelect";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { CANCEL_REASON } from "@/lib/enums";
import { cancellationOutcome } from "@/lib/domain/schedule";
import { formatTimeRange12, formatDate } from "@/lib/time";
import { PendingSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice", LEAGUE_MATCH: "League match", CHAMPIONSHIP: "Championship", ALA_CARTE: "Private Lessons",
};

const OK_LABEL: Record<string, string> = {
  cancel: "Session cancelled.",
  relocate: "Session relocated.",
  attendance: "Attendance saved.",
  edited: "Session updated.",
  subAdded: "Coach added to this class.",
  subRemoved: "Coach removed from this class.",
};

const ERR_LABEL: Record<string, string> = {
  auth: "You are not authorized to perform that action.",
  session: "Session not found.",
  facility: "Choose a facility to relocate to.",
  coachgate: "That coach isn't cleared to be assigned (background check required).",
  subclash: "That coach already covers another class at this time. Use “add anyway” to override.",
  op: "Unknown action.",
};

const COACH_ROLE_LABEL: Record<string, string> = {
  PRIMARY: "Primary", ASSISTANT: "Assistant", SUBSTITUTE: "Substitute", BACKUP: "Backup",
};

// Attendance choices. `on` holds the peer-checked classes so the tapped option
// highlights live (green/red/amber) with no JavaScript.
const ATT_OPTS = [
  { value: "PRESENT", label: "Present", on: "peer-checked:bg-emerald-600 peer-checked:text-white" },
  { value: "ABSENT", label: "Absent", on: "peer-checked:bg-rose-600 peer-checked:text-white" },
  { value: "EXCUSED", label: "Excused", on: "peer-checked:bg-amber-500 peer-checked:text-white" },
];

export default async function SessionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const ticket = await mintConsoleTicket();
  const returnTo = `/console/schedule/${id}`;
  const s = await prisma.session.findUnique({
    where: { id },
    include: {
      facility: true,
      teams: { include: { team: { include: { members: { include: { person: true } } } } } },
      coaches: true,
      attendance: true,
    },
  });
  if (!s) notFound();

  const facilities = await prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const allCoaches = await prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } });
  const coachName = new Map(allCoaches.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`]));
  const sessionCoachIds = new Set(s.coaches.map((c) => c.coachId));
  const attMap = new Map(s.attendance.map((a) => [a.personId, a.status]));
  const roster = s.teams.flatMap((t) => t.team.members.map((m) => ({ ...m, teamName: t.team.name })));
  const active = s.status === "SCHEDULED" || s.status === "DELIVERED";
  const outcome = cancellationOutcome(s.type);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/console/schedule" className="text-sm text-brand-600 hover:underline">← Schedule</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">
            {TYPE_LABEL[s.type] ?? s.type} · {formatDate(s.date)}
          </h1>
          <StatusBadge status={s.status} />
        </div>
        <p className="text-sm text-slate-500">
          {s.teams.map((t) => t.team.name).join(", ")} · {s.facility?.name ?? "no facility"} · {formatTimeRange12(s.startTime, s.endTime)}
          {s.weekNumber ? ` · week ${s.weekNumber}` : ""}
        </p>
        {s.cancelReason && (
          <p className="mt-1 text-sm text-rose-600">Reason: {s.cancelReason.toLowerCase().replace(/_/g, " ")}</p>
        )}
      </div>

      {ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{OK_LABEL[ok] ?? "Done."}</div>
      )}
      {err && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{ERR_LABEL[err] ?? "Something went wrong."}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Attendance — mobile-first (§18) */}
        <form method="POST" action="/api/console/schedule" className="card lg:col-span-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="attendance" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="sessionId" value={s.id} />
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Attendance</h2>
            <span className="text-xs text-slate-400">{roster.length} players</span>
          </div>
          {roster.length === 0 ? (
            <p className="text-sm text-slate-400">No roster on this session.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {roster.map((m) => {
                const cur = attMap.get(m.personId) ?? "PRESENT";
                return (
                  <li key={m.personId} className="py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium text-slate-800">{m.person.firstName} {m.person.lastName}</span>
                      {/* Big, full-width tap targets on a phone; compact on desktop.
                          The radio is the CSS `peer` and the styled span is its
                          sibling, so the selection highlights live on tap — no
                          JS, and it still submits with the form. */}
                      <div className="grid grid-cols-3 gap-1 sm:flex">
                        {ATT_OPTS.map((opt) => (
                          <label key={opt.value} className="block cursor-pointer">
                            <input type="radio" name={`att_${m.personId}`} value={opt.value} defaultChecked={cur === opt.value} className="peer sr-only" />
                            <span className={`block rounded-lg px-3 py-2.5 text-center text-sm font-medium ring-1 ring-inset ring-transparent bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 sm:py-1.5 sm:text-xs ${opt.on}`}>
                              {opt.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {roster.length > 0 && (
            <div className="mt-4 flex justify-stretch sm:justify-end">
              <PendingSubmit label="Save attendance" pendingLabel="Saving…" className="btn-primary w-full sm:w-auto" />
            </div>
          )}
        </form>

        {/* Session controls */}
        <div className="space-y-4">
          {/* Coaching — primary + add a substitute/backup for this one class */}
          <div className="card">
            <h2 className="mb-2 font-semibold text-slate-900">Coaching</h2>
            {s.coaches.length === 0 ? (
              <p className="mb-3 text-sm text-slate-400">No coach on this class yet.</p>
            ) : (
              <ul className="mb-3 space-y-2">
                {s.coaches.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm ring-1 ring-slate-100">
                    <span className="text-slate-700">{coachName.get(c.coachId) ?? "Unknown coach"}</span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${c.role === "PRIMARY" ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}`}>
                        {COACH_ROLE_LABEL[c.role] ?? c.role}
                      </span>
                      {c.role !== "PRIMARY" && (
                        <form method="POST" action="/api/console/schedule">
                          <input type="hidden" name="ticket" value={ticket} />
                          <input type="hidden" name="op" value="removeSessionCoach" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="sessionId" value={s.id} />
                          <input type="hidden" name="coachId" value={c.coachId} />
                          <button className="text-xs text-rose-600 hover:underline">Remove</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form method="POST" action="/api/console/schedule" className="space-y-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="assignSubstitute" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="sessionId" value={s.id} />
              <label className="label">Add a substitute / backup for this class</label>
              <select name="coachId" className="input" required>
                <option value="">— choose coach —</option>
                {allCoaches
                  .filter((c) => !sessionCoachIds.has(c.id))
                  .map((c) => <option key={c.id} value={c.id}>{c.person.firstName} {c.person.lastName}</option>)}
              </select>
              <select name="role" className="input">
                <option value="SUBSTITUTE">Substitute</option>
                <option value="BACKUP">Backup</option>
                <option value="ASSISTANT">Assistant</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="force" value="1" />
                Add even if it overlaps another class they cover
              </label>
              <button className="btn-secondary w-full text-sm">Add coach to this class</button>
            </form>
          </div>

          {/* Reschedule — date, time, facility */}
          <form method="POST" action="/api/console/schedule" className="card">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="editSession" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="sessionId" value={s.id} />
            <h2 className="mb-3 font-semibold text-slate-900">Reschedule</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Date</label>
                <DateField name="date" className="input" defaultValue={s.date.toISOString().slice(0, 10)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Start</label><TimeSelect name="startTime" className="input" defaultValue={s.startTime} /></div>
                <div><label className="label">End</label><TimeSelect name="endTime" className="input" defaultValue={s.endTime} /></div>
              </div>
              <div>
                <label className="label">Facility</label>
                <select name="facilityId" className="input" defaultValue={s.facilityId ?? ""}>
                  <option value="">— none —</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="notify" value="1" defaultChecked />
                Notify the team of the change
              </label>
              <button className="btn-primary w-full">Save changes</button>
            </div>
          </form>

          {active && (
            <form method="POST" action="/api/console/schedule" className="card">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="cancel" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <h2 className="mb-2 font-semibold text-slate-900">Cancel session</h2>
              <p className="mb-3 text-xs text-slate-500">{outcome.note}</p>
              <label className="label" htmlFor="reason">Reason</label>
              <select id="reason" name="reason" className="input">
                {CANCEL_REASON.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase().replace(/_/g, " ")}</option>)}
              </select>
              <input type="hidden" name="sessionId" value={s.id} />
              <button className="btn-secondary mt-3 w-full text-rose-700 ring-rose-200 hover:bg-rose-50">
                {s.type === "PRACTICE" ? "Cancel practice" : "Cancel & reschedule"}
              </button>
            </form>
          )}

          <form method="POST" action="/api/console/schedule" className="card">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="relocate" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <h2 className="mb-2 font-semibold text-slate-900">Relocate</h2>
            <p className="mb-3 text-xs text-slate-500">Move to an indoor/alternative court to preserve the session as delivered.</p>
            <input type="hidden" name="sessionId" value={s.id} />
            <select name="facilityId" className="input" defaultValue={s.relocatedFacilityId ?? ""}>
              <option value="">— choose facility —</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="notify" value="1" defaultChecked />
              Notify the team of the new location
            </label>
            <button className="btn-ghost mt-3 w-full">Relocate session</button>
          </form>
        </div>
      </div>
    </div>
  );
}
