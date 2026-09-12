import Link from "next/link";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { DEV_CATEGORIES, DEV_RATINGS, DEV_NOTE, PROGRESS_WEEKS } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player Development Tracker" };

const DEV_KEYS = DEV_CATEGORIES.map((c) => c.key);

export default async function DevelopmentTrackerPage({
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
  const wkParsed = parseInt(sp.week ?? "1", 10);
  const week = Number.isFinite(wkParsed) && wkParsed >= 1 && wkParsed <= PROGRESS_WEEKS ? wkParsed : 1;

  const members = selectedId
    ? await prisma.teamMember.findMany({
        where: { teamId: selectedId, roleOnTeam: "PLAYER" },
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { person: { firstName: "asc" } },
      })
    : [];
  const entries = selectedId
    ? await prisma.playerProgressEntry.findMany({ where: { teamId: selectedId, week, metric: { in: [...DEV_KEYS, DEV_NOTE] } } })
    : [];
  const rating = new Map<string, string>(); // pid:metric -> value
  const notes = new Map<string, string>();
  for (const e of entries) {
    if (e.metric === DEV_NOTE) notes.set(e.personId, e.note ?? "");
    else rating.set(`${e.personId}:${e.metric}`, e.value === null || e.value === undefined ? "" : String(e.value));
  }

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Player Development Tracker" subtitle="Rate each player across the core skills — Needs work, Improving, or Strength — each week. Rating weekly lets you see each skill grow across the season." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved week {week}.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/development" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Team</label>
          <select name="team" defaultValue={selectedId} className="input">
            <option value="">Choose a team…</option>
            {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Week</label>
          <select name="week" defaultValue={String(week)} className="input">
            {Array.from({ length: PROGRESS_WEEKS }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
        <button className="btn-secondary text-sm">Open</button>
      </form>

      {!selectedId ? (
        <div className="card text-sm text-slate-400">Pick a team to rate development.</div>
      ) : members.length === 0 ? (
        <div className="card text-sm text-slate-400">No players on this team yet.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveDevelopment" />
          <input type="hidden" name="formSlug" value="development" />
          <input type="hidden" name="teamId" value={selectedId} />
          <input type="hidden" name="week" value={week} />
          <input type="hidden" name="personIds" value={members.map((m) => m.personId).join(",")} />

          <div className="card overflow-x-auto p-0">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left">Player</th>
                  {DEV_CATEGORIES.map((c) => <th key={c.key} className="border-l border-slate-200 px-2 py-2 text-center">{c.label}</th>)}
                  <th className="border-l border-slate-200 px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.personId}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{m.person.firstName} {m.person.lastName}</td>
                    {DEV_CATEGORIES.map((c) => (
                      <td key={c.key} className="border-l border-slate-200 px-1 py-1 text-center">
                        <select name={`dev_${m.personId}_${c.key}`} defaultValue={rating.get(`${m.personId}:${c.key}`) ?? ""} className="rounded border border-slate-200 px-1 py-0.5 text-xs">
                          {DEV_RATINGS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
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

          <div className="flex items-center justify-end">
            <button className="btn-primary">Save tracker</button>
          </div>
        </form>
      )}
    </div>
  );
}
