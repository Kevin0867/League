import Link from "next/link";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { LADDER_COLUMNS, LADDER_NOTE } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly Ladder & Challenge Match Tracker" };

export default async function LadderTrackerPage({
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
  const ladderKeys = LADDER_COLUMNS.map((c) => c.key);
  const entries = selectedId
    ? await prisma.playerProgressEntry.findMany({ where: { teamId: selectedId, week: 0, metric: { in: [...ladderKeys, LADDER_NOTE] } } })
    : [];
  const val = new Map<string, number | null>();
  const notes = new Map<string, string>();
  for (const e of entries) {
    if (e.metric === LADDER_NOTE) notes.set(e.personId, e.note ?? "");
    else val.set(`${e.personId}:${e.metric}`, e.value ?? null);
  }
  const cell = (pid: string, metric: string) => {
    const v = val.get(`${pid}:${metric}`);
    return v === null || v === undefined ? "" : String(v);
  };

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Weekly Ladder & Challenge Match Tracker" subtitle="Keep a running standings snapshot from ladder and challenge matches — wins, losses, points, and current rank. Use the note for challenge-match observations." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/ladder" className="card flex flex-wrap items-end gap-3">
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
        <div className="card text-sm text-slate-400">Pick a team to record the ladder.</div>
      ) : members.length === 0 ? (
        <div className="card text-sm text-slate-400">No players on this team yet.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveLadder" />
          <input type="hidden" name="formSlug" value="ladder" />
          <input type="hidden" name="teamId" value={selectedId} />
          <input type="hidden" name="personIds" value={members.map((m) => m.personId).join(",")} />

          <div className="card overflow-x-auto p-0">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left">Player</th>
                  {LADDER_COLUMNS.map((c) => <th key={c.key} className="border-l border-slate-200 px-2 py-2 text-center">{c.label}</th>)}
                  <th className="border-l border-slate-200 px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.personId}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{m.person.firstName} {m.person.lastName}</td>
                    {LADDER_COLUMNS.map((c) => (
                      <td key={c.key} className="border-l border-slate-200 px-1 py-1 text-center">
                        <input type="number" min={0} step={1} name={`ladder_${m.personId}_${c.key}`} defaultValue={cell(m.personId, c.key)} className="w-16 rounded border border-slate-200 px-1 py-0.5 text-center text-sm" />
                      </td>
                    ))}
                    <td className="border-l border-slate-200 px-2 py-1">
                      <input name={`note_${m.personId}`} defaultValue={notes.get(m.personId) ?? ""} className="w-52 rounded border border-slate-200 px-2 py-0.5 text-sm" placeholder="Challenge-match note…" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end">
            <button className="btn-primary">Save tracker</button>
          </div>
        </form>
      )}
    </div>
  );
}
