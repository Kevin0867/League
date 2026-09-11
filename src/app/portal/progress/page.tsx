import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { buildTeamAnalytics } from "@/lib/domain/formsAnalytics";
import { Sparkline, SkillBars, StatTile, DeltaBadge } from "@/components/ProgressCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Progress" };

// A player (and their parents) can see the progress report a coach has chosen
// to share for each of their teams. Built from the same analytics as the coach
// dashboard, so the numbers always match.
export default async function PortalProgressPage() {
  const session = await requireUser();
  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId }, include: { dependents: { select: { id: true } } } })
    : null;
  const peopleIds = [...(me ? [me.id] : []), ...(me?.dependents.map((d) => d.id) ?? [])];

  // Team memberships where the coach has shared the report.
  const memberships = peopleIds.length
    ? await prisma.teamMember.findMany({
        where: { personId: { in: peopleIds }, roleOnTeam: "PLAYER", team: { progressShared: true, isTest: false } },
        include: { team: { select: { id: true, name: true } } },
      })
    : [];

  // Group by team so we build analytics once per team, then show only the
  // household's players from it.
  const byTeam = new Map<string, { name: string; personIds: string[] }>();
  for (const m of memberships) {
    if (!byTeam.has(m.teamId)) byTeam.set(m.teamId, { name: m.team.name, personIds: [] });
    byTeam.get(m.teamId)!.personIds.push(m.personId);
  }

  const reports = await Promise.all(
    [...byTeam.entries()].map(async ([teamId, info]) => {
      const analytics = await buildTeamAnalytics(teamId, { personIds: info.personIds });
      return { teamId, teamName: info.name, players: analytics.players.filter((p) => p.hasData) };
    }),
  );
  const anyData = reports.some((r) => r.players.length > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Progress</h1>
        <p className="text-sm text-slate-500">How things are trending on court — shared by your coach. Great to review together before the next session.</p>
      </div>

      {!anyData ? (
        <div className="card text-sm text-slate-500">
          No progress report to show yet. Your coach shares these once there&apos;s enough data — check back after a few weeks of sessions.
        </div>
      ) : (
        reports.filter((r) => r.players.length > 0).map((r) => (
          <section key={r.teamId} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">{r.teamName}</h2>
            {r.players.map((p) => (
              <div key={p.personId} className="card space-y-4">
                <div className="font-semibold text-slate-900">{p.name}</div>

                {(p.serve.count > 0 || p.ret.count > 0 || p.kitchen.count > 0) && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[{ k: "Serve depth", s: p.serve, c: "#0e7490" }, { k: "Return depth", s: p.ret, c: "#10b981" }, { k: "Kitchen line", s: p.kitchen, c: "#f59e0b" }].map(({ k, s, c }) => (
                      <div key={k}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-600">{k}</span>
                          <DeltaBadge delta={s.delta} />
                        </div>
                        <div className="text-lg font-bold text-slate-800">{s.latest ?? "—"}{s.latest !== null ? <span className="text-xs text-slate-400">%</span> : null}</div>
                        <Sparkline points={s.series} color={c} />
                        {s.delta !== null && s.delta > 0 && <div className="text-[11px] text-emerald-600">Up {s.delta}% since week 1 💪</div>}
                      </div>
                    ))}
                  </div>
                )}

                {p.development.ratings.some((rr) => rr.value !== null) && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-500">Skills</div>
                    <SkillBars ratings={p.development.ratings} />
                    {p.development.strengths.length > 0 && (
                      <p className="mt-2 text-xs text-slate-600"><span className="font-semibold text-emerald-700">Strengths:</span> {p.development.strengths.join(", ")}</p>
                    )}
                    {p.development.focus.length > 0 && (
                      <p className="text-xs text-slate-600"><span className="font-semibold text-amber-700">Working on:</span> {p.development.focus.join(", ")}</p>
                    )}
                  </div>
                )}

                {p.ladder && (
                  <div className="grid grid-cols-4 gap-2">
                    <StatTile label="Record" value={`${p.ladder.wins ?? 0}–${p.ladder.losses ?? 0}`} tone="slate" />
                    <StatTile label="Win %" value={p.ladder.winPct} unit="%" tone="emerald" />
                    <StatTile label="Pt diff" value={p.ladder.diff !== null && p.ladder.diff > 0 ? `+${p.ladder.diff}` : p.ladder.diff} tone="brand" />
                    <StatTile label="Rank" value={p.ladder.rank} tone="slate" />
                  </div>
                )}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
