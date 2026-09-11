import Link from "next/link";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { PROGRESS_WEEKS, KA_METRIC, KA_NOTE } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kitchen Arrival Tracker" };

const WEEKS = Array.from({ length: PROGRESS_WEEKS }, (_, i) => i + 1);

export default async function KitchenArrivalTrackerPage({
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
    ? await prisma.playerProgressEntry.findMany({ where: { teamId: selectedId, metric: { in: [KA_METRIC, KA_NOTE] } } })
    : [];
  const val = new Map<string, number | null>();
  const notes = new Map<string, string>();
  for (const e of entries) {
    if (e.metric === KA_NOTE) notes.set(e.personId, e.note ?? "");
    else val.set(`${e.personId}:${e.week}`, e.value ?? null);
  }
  const cell = (pid: string, wk: number) => {
    const v = val.get(`${pid}:${wk}`);
    return v === null || v === undefined ? "" : String(v);
  };

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Kitchen Arrival Tracker" subtitle="Record how often each player gets established at the kitchen line — a percentage of points (times to the line ÷ points played) works well. Saved per week so you can watch the trend." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/kitchen-arrival" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Team</label>
          <select name="team" defaultValue={selectedId} className="input">
            <option value="">Choose a team…</option>
            {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary text-sm">Open</button>
      </form>

      {!selectedId ? (
        <div className="card text-sm text-slate-400">Pick a team to record kitchen arrivals.</div>
      ) : members.length === 0 ? (
        <div className="card text-sm text-slate-400">No players on this team yet.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveKitchenArrival" />
          <input type="hidden" name="formSlug" value="kitchen-arrival" />
          <input type="hidden" name="teamId" value={selectedId} />
          <input type="hidden" name="personIds" value={members.map((m) => m.personId).join(",")} />

          <div className="card overflow-x-auto p-0">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left">Player</th>
                  {WEEKS.map((wk) => <th key={wk} className="border-l border-slate-200 px-2 py-2 text-center">Wk {wk}</th>)}
                  <th className="border-l border-slate-200 px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.personId}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{m.person.firstName} {m.person.lastName}</td>
                    {WEEKS.map((wk) => (
                      <td key={wk} className="border-l border-slate-200 px-1 py-1 text-center">
                        <input type="number" min={0} max={100} name={`ka_${m.personId}_${wk}`} defaultValue={cell(m.personId, wk)} className="w-14 rounded border border-slate-200 px-1 py-0.5 text-center text-sm" placeholder="%" />
                      </td>
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
            <p className="text-xs text-slate-400">Enter a percentage 0–100 for each week. Blank weeks are left empty.</p>
            <button className="btn-primary">Save tracker</button>
          </div>
        </form>
      )}
    </div>
  );
}
