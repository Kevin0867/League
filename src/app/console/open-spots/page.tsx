import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { TEAM_CAP } from "@/lib/enums";
import { formatTime12 } from "@/lib/time";
import { getOpenSpotsCopy, teamCapacity } from "@/lib/domain/openSpots";

export const dynamic = "force-dynamic";
export const metadata = { title: "Open Spots" };

export default async function OpenSpotsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));

  const teams = season
    ? await prisma.team.findMany({
        where: { seasonId: season.id, club: "PURE", isTest: false },
        select: {
          id: true, name: true, market: true, divisionCode: true, dayOfWeek: true, startTime: true,
          coachPlays: true, acceptingSignups: true, capacity: true,
          facility: { select: { name: true } },
          _count: { select: { members: true } },
        },
        orderBy: [{ market: "asc" }, { name: "asc" }],
      })
    : [];
  const copy = await getOpenSpotsCopy();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Open Spots" subtitle="Check a team to advertise its open spots on the public page and accept self-serve signups. Unchecked teams are never shown and can't take signups." />
        <Link href="/open-spots" target="_blank" className="btn-secondary text-sm">View public page →</Link>
      </div>

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Couldn&apos;t save — try again.</div>}

      {!season ? (
        <div className="card text-sm text-slate-400">No active season.</div>
      ) : (
        <form method="POST" action="/api/console/open-spots" className="space-y-5">
          <input type="hidden" name="ticket" value={ticket} />

          <div className="card space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">Page copy</h2>
            <div>
              <label className="label">Headline</label>
              <input name="headline" className="input" defaultValue={copy.headline} />
            </div>
            <div>
              <label className="label">Intro</label>
              <textarea name="intro" rows={3} className="input" defaultValue={copy.intro} />
            </div>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2">Available</th>
                  <th>Team</th>
                  <th>Practice</th>
                  <th>Roster</th>
                  <th className="pr-4">Target size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teams.map((t) => {
                  const roster = t._count.members + (t.coachPlays ? 1 : 0);
                  const cap = teamCapacity(t.capacity);
                  const left = Math.max(0, cap - roster);
                  return (
                    <tr key={t.id} className={t.acceptingSignups ? "bg-emerald-50/40" : ""}>
                      <td className="px-4 py-2">
                        <input type="hidden" name="teamId" value={t.id} />
                        <input type="checkbox" name={`signup_${t.id}`} defaultChecked={t.acceptingSignups} className="h-4 w-4 accent-brand-600" aria-label={`Advertise ${t.name}`} />
                      </td>
                      <td className="py-2">
                        <div className="font-medium text-slate-800">{t.name}</div>
                        <div className="text-xs text-slate-400">{[t.divisionCode, t.market, t.facility?.name].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="text-slate-500">{t.dayOfWeek && t.startTime ? `${t.dayOfWeek} ${formatTime12(t.startTime)}` : "—"}</td>
                      <td className="text-slate-500">{roster} on team · <span className={left > 0 ? "text-emerald-700" : "text-rose-600"}>{left} open</span></td>
                      <td className="pr-4">
                        <input type="number" name={`cap_${t.id}`} min={1} defaultValue={t.capacity ?? ""} placeholder={String(TEAM_CAP)} className="input w-20 py-1" />
                      </td>
                    </tr>
                  );
                })}
                {teams.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No teams in the active season yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Target size defaults to {TEAM_CAP} if left blank. Spots left = target − current roster.</p>
            <button className="btn-primary">Save</button>
          </div>
        </form>
      )}
    </div>
  );
}
