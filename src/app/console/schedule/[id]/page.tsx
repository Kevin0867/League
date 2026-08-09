import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { CANCEL_REASON } from "@/lib/enums";
import { cancellationOutcome } from "@/lib/domain/schedule";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice", LEAGUE_MATCH: "League match", CHAMPIONSHIP: "Championship", ALA_CARTE: "À la carte",
};

const OK_LABEL: Record<string, string> = {
  cancel: "Session cancelled.",
  relocate: "Session relocated.",
  attendance: "Attendance saved.",
};

const ERR_LABEL: Record<string, string> = {
  auth: "You are not authorized to perform that action.",
  session: "Session not found.",
  facility: "Choose a facility to relocate to.",
  op: "Unknown action.",
};

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

  const facilities = await prisma.facility.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
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
            {TYPE_LABEL[s.type] ?? s.type} · {s.date.toLocaleDateString()}
          </h1>
          <StatusBadge status={s.status} />
        </div>
        <p className="text-sm text-slate-500">
          {s.teams.map((t) => t.team.name).join(", ")} · {s.facility?.name ?? "no facility"} · {s.startTime}–{s.endTime}
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
                  <li key={m.personId} className="flex items-center justify-between gap-3 py-3">
                    <span className="text-sm font-medium text-slate-800">{m.person.firstName} {m.person.lastName}</span>
                    <div className="flex gap-1">
                      {["PRESENT", "ABSENT", "EXCUSED"].map((opt) => (
                        <label key={opt} className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium ${cur === opt ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                          <input type="radio" name={`att_${m.personId}`} value={opt} defaultChecked={cur === opt} className="sr-only" />
                          {opt[0] + opt.slice(1).toLowerCase()}
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {roster.length > 0 && (
            <div className="mt-4 flex justify-end">
              <button className="btn-primary">Save attendance</button>
            </div>
          )}
        </form>

        {/* Session controls */}
        <div className="space-y-4">
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
            <button className="btn-ghost mt-3 w-full">Relocate session</button>
          </form>
        </div>
      </div>
    </div>
  );
}
