import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formTeamOptions } from "@/lib/domain/formsAccess";
import { buildTeamAnalytics } from "@/lib/domain/formsAnalytics";
import { Sparkline, SkillBars, StatTile, DeltaBadge, GrowthSummary, WowTable } from "@/components/ProgressCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Progress Analytics" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const teamOptions = await formTeamOptions(session);
  const selectedId = sp.team && teamOptions.some((t) => t.id === sp.team) ? sp.team : "";

  const team = selectedId ? await prisma.team.findUnique({ where: { id: selectedId }, select: { name: true, progressShared: true } }) : null;
  const analytics = selectedId ? await buildTeamAnalytics(selectedId) : null;

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Progress Analytics" subtitle="Everything the coaching forms capture, rolled up into a shareable progress report. Fill out the trackers and this updates automatically." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}

      <form method="GET" action="/console/forms/analytics" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Team</label>
          <select name="team" defaultValue={selectedId} className="input">
            <option value="">Choose a team…</option>
            {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary text-sm">Open</button>
      </form>

      {!selectedId || !analytics ? (
        <div className="card text-sm text-slate-400">Pick a team to see its analytics.</div>
      ) : analytics.team.withData === 0 ? (
        <div className="card text-sm text-slate-500">
          No tracker data for this team yet. Fill out the{" "}
          <Link href={`/console/forms/serve-return?team=${selectedId}`} className="text-brand-700 hover:underline">Serve &amp; Return</Link>,{" "}
          <Link href={`/console/forms/development?team=${selectedId}`} className="text-brand-700 hover:underline">Development</Link>, or{" "}
          <Link href={`/console/forms/ladder?team=${selectedId}`} className="text-brand-700 hover:underline">Ladder</Link> trackers and the analytics will appear here.
        </div>
      ) : (
        <>
          {/* Share control */}
          <div className={`card flex flex-wrap items-center justify-between gap-3 border-l-4 ${team?.progressShared ? "border-emerald-400" : "border-slate-300"}`}>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {team?.progressShared ? "Shared with players & parents" : "Not shared yet"}
              </div>
              <p className="text-xs text-slate-500">
                {team?.progressShared
                  ? "Each player and their parents can see their own progress report in the portal."
                  : "Turn this on when the numbers are ready — players and parents will then see their own report in the portal."}
              </p>
            </div>
            <form method="POST" action="/api/console/forms">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="toggleProgressShare" />
              <input type="hidden" name="formSlug" value="analytics" />
              <input type="hidden" name="teamId" value={selectedId} />
              <input type="hidden" name="share" value={team?.progressShared ? "0" : "1"} />
              <button className={team?.progressShared ? "btn-secondary text-sm" : "btn-primary text-sm"}>
                {team?.progressShared ? "Stop sharing" : "Share with players & parents"}
              </button>
            </form>
          </div>

          {/* Team overview */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">{team?.name} — team overview</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile label="Avg serve" value={analytics.team.serveAvg} tone="brand" />
              <StatTile label="Avg return" value={analytics.team.returnAvg} tone="emerald" />
              <StatTile label="Avg kitchen" value={analytics.team.kitchenAvg} unit="%" tone="amber" />
              <StatTile label="Most improved" value={analytics.team.mostImproved?.name ?? null} sub={analytics.team.mostImproved ? `+${analytics.team.mostImproved.delta} avg gain` : undefined} tone="emerald" />
              <StatTile label="Homework done" value={analytics.team.homework?.rate ?? null} unit="%" sub={analytics.team.homework ? `${analytics.team.homework.completed}/${analytics.team.homework.assigned} weeks` : undefined} tone="slate" />
            </div>
            {analytics.team.devSkillAvg.some((s) => s.value !== null) && (
              <div className="card">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Team skill averages (1–3)</div>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {analytics.team.devSkillAvg.map((s) => (
                    <div key={s.key} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{s.label}</span>
                      <span className="font-semibold text-slate-800">{s.value ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Team week-over-week */}
          {(analytics.team.weekly.serve.some((v) => v !== null) || analytics.team.weekly.ret.some((v) => v !== null) || analytics.team.weekly.kitchen.some((v) => v !== null) || analytics.team.movers.length > 0) && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">Team — week over week</h2>
              <div className="card overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-400">
                      <th className="py-1 pr-3 text-left">Team average</th>
                      {analytics.team.weekly.serve.map((_, i) => <th key={i} className="px-2 py-1 text-center">Wk {i + 1}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[{ k: "Serve", row: analytics.team.weekly.serve, u: "" }, { k: "Return", row: analytics.team.weekly.ret, u: "" }, { k: "Kitchen", row: analytics.team.weekly.kitchen, u: "%" }].filter(({ row }) => row.some((v) => v !== null)).map(({ k, row, u }) => (
                      <tr key={k}>
                        <td className="py-1 pr-3 font-medium text-slate-700">{k}</td>
                        {row.map((v, i) => <td key={i} className="px-2 py-1 text-center text-slate-700">{v === null ? <span className="text-slate-300">—</span> : `${v}${u}`}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analytics.team.movers.length > 0 && (
                <div className="card">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Biggest movers</div>
                  <ul className="space-y-1 text-sm">
                    {analytics.team.movers.map((m, i) => (
                      <li key={`${m.personId}-${m.metric}-${i}`} className="flex items-center justify-between">
                        <span className="text-slate-700"><span className="font-medium">{m.name}</span> · {m.metric}</span>
                        <span className="font-semibold text-emerald-600">+{m.delta}{m.metric === "Kitchen" ? "%" : ""}{m.pctChange !== null ? ` (+${m.pctChange}%)` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Per-player */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-800">By player</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {analytics.players.filter((p) => p.hasData).map((p) => (
                <div key={p.personId} className="card space-y-3">
                  <div className="font-semibold text-slate-900">{p.name}</div>

                  {(p.serve.count > 0 || p.ret.count > 0 || p.kitchen.count > 0) && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      {[{ k: "Serve", s: p.serve, c: "#0e7490", unit: "", max: undefined as number | undefined }, { k: "Return", s: p.ret, c: "#10b981", unit: "", max: undefined as number | undefined }, { k: "Kitchen", s: p.kitchen, c: "#f59e0b", unit: "%", max: 100 as number | undefined }].map(({ k, s, c, unit, max }) => (
                        <div key={k}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-600">{k}</span>
                            <DeltaBadge delta={s.delta} unit={unit} />
                          </div>
                          <div className="text-lg font-bold text-slate-800">{s.latest ?? "—"}{s.latest !== null && unit ? <span className="text-xs text-slate-400">{unit}</span> : null}</div>
                          <Sparkline points={s.series} color={c} unit={unit} max={max} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Week-over-week progression + growth stats for each shot. */}
                  {[{ k: "Serve", s: p.serve, unit: "" }, { k: "Return", s: p.ret, unit: "" }, { k: "Kitchen", s: p.kitchen, unit: "%" }].filter(({ s }) => s.count >= 2).length > 0 && (
                    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week over week</div>
                      {[{ k: "Serve", s: p.serve, unit: "" }, { k: "Return", s: p.ret, unit: "" }, { k: "Kitchen", s: p.kitchen, unit: "%" }].filter(({ s }) => s.count >= 2).map(({ k, s, unit }) => (
                        <div key={k} className="space-y-1">
                          <div className="text-xs font-semibold text-slate-700">{k}</div>
                          <GrowthSummary stat={s} unit={unit} />
                          <WowTable stat={s} unit={unit} />
                        </div>
                      ))}
                    </div>
                  )}

                  {p.development.ratings.some((r) => r.value !== null) && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-500">Skill development{p.development.hasWeekly ? " — latest" : ""}</div>
                      <SkillBars ratings={p.development.ratings} />
                    </div>
                  )}

                  {/* Per-skill week-over-week when development is rated weekly. */}
                  {p.development.hasWeekly && (
                    <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skill growth (1–3)</div>
                      {p.development.skills.filter((s) => s.trend.count >= 2).map((s) => (
                        <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
                          <span className="w-28 shrink-0 text-slate-600">{s.label}</span>
                          <span className="flex-1"><GrowthSummary stat={s.trend} /></span>
                        </div>
                      ))}
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
            </div>
          </section>
        </>
      )}
    </div>
  );
}
