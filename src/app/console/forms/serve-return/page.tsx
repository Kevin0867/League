import Link from "next/link";
import { Fragment } from "react";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { PROGRESS_WEEKS, SR_SERVE, SR_RETURN, SR_NOTE } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Serve & Return Progress Tracker" };

const WEEKS = Array.from({ length: PROGRESS_WEEKS }, (_, i) => i + 1);

export default async function ServeReturnTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const admin = isAdmin(session.roles ?? [session.role]);

  const myCoach = !admin && session.personId
    ? await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true } })
    : null;
  const teamOptions = admin
    ? await prisma.team.findMany({ where: { isTest: false, season: { active: true } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : myCoach
      ? await prisma.team.findMany({ where: { season: { active: true }, OR: [{ coachId: myCoach.id }, { assistantCoaches: { some: { coachId: myCoach.id } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];

  const selectedId = sp.team && teamOptions.some((t) => t.id === sp.team) ? sp.team : "";

  const members = selectedId
    ? await prisma.teamMember.findMany({
        where: { teamId: selectedId, roleOnTeam: "PLAYER" },
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { person: { firstName: "asc" } },
      })
    : [];
  const entries = selectedId
    ? await prisma.playerProgressEntry.findMany({ where: { teamId: selectedId, metric: { in: [SR_SERVE, SR_RETURN, SR_NOTE] } } })
    : [];
  // value[personId][week][metric] and note[personId]
  const val = new Map<string, number | null>();
  const notes = new Map<string, string>();
  for (const e of entries) {
    if (e.metric === SR_NOTE) notes.set(e.personId, e.note ?? "");
    else val.set(`${e.personId}:${e.week}:${e.metric}`, e.value ?? null);
  }
  const cell = (pid: string, wk: number, metric: string) => {
    const v = val.get(`${pid}:${wk}:${metric}`);
    return v === null || v === undefined ? "" : String(v);
  };

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Serve & Return Progress Tracker" subtitle="Use the same target area each week. Record a percentage (successful deep balls ÷ attempts) for Serve and Return. Saved per player so you can watch the trend across the season." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/serve-return" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Team</label>
          <select name="team" defaultValue={selectedId} className="input" onChange={undefined}>
            <option value="">Choose a team…</option>
            {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary text-sm">Open</button>
      </form>

      {!selectedId ? (
        <div className="card text-sm text-slate-400">Pick a team to record serve & return progress.</div>
      ) : members.length === 0 ? (
        <div className="card text-sm text-slate-400">No players on this team yet.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveServeReturn" />
          <input type="hidden" name="teamId" value={selectedId} />
          <input type="hidden" name="personIds" value={members.map((m) => m.personId).join(",")} />

          <div className="card overflow-x-auto p-0">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th rowSpan={2} className="sticky left-0 z-10 bg-white px-3 py-2 text-left">Player</th>
                  {WEEKS.map((wk) => (
                    <th key={wk} colSpan={2} className="border-l border-slate-200 px-2 py-1 text-center">Wk {wk}</th>
                  ))}
                  <th rowSpan={2} className="border-l border-slate-200 px-3 py-2 text-left">Notes</th>
                </tr>
                <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                  {WEEKS.map((wk) => (
                    <Fragment key={wk}>
                      <th className="border-l border-slate-200 px-1 py-1 font-semibold text-brand-700">Serve</th>
                      <th className="px-1 py-1 font-semibold text-emerald-700">Return</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.personId}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{m.person.firstName} {m.person.lastName}</td>
                    {WEEKS.map((wk) => (
                      <Fragment key={wk}>
                        <td className="border-l border-slate-200 px-1 py-1">
                          <input type="number" min={0} max={100} name={`sr_${m.personId}_${wk}_SERVE`} defaultValue={cell(m.personId, wk, SR_SERVE)} className="w-14 rounded border border-slate-200 px-1 py-0.5 text-center text-sm" placeholder="%" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" min={0} max={100} name={`sr_${m.personId}_${wk}_RETURN`} defaultValue={cell(m.personId, wk, SR_RETURN)} className="w-14 rounded border border-slate-200 px-1 py-0.5 text-center text-sm" placeholder="%" />
                        </td>
                      </Fragment>
                    ))}
                    <td className="border-l border-slate-200 px-2 py-1">
                      <input name={`note_${m.personId}`} defaultValue={notes.get(m.personId) ?? ""} className="w-44 rounded border border-slate-200 px-2 py-0.5 text-sm" placeholder="Note…" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Enter a percentage 0–100 for each week. Blank weeks are left empty. S/R = Serve % / Return %.</p>
            <button className="btn-primary">Save tracker</button>
          </div>
        </form>
      )}
    </div>
  );
}
