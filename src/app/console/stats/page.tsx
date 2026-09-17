import Link from "next/link";
import { PageHeader } from "@/components/RoadmapNote";
import { requireAdmin } from "@/lib/rbac";
import { academyStats } from "@/lib/domain/stats";

export const dynamic = "force-dynamic";

export const metadata = { title: "Stats" };

// Academy & League at a glance. Every number is derived live from the active
// season(s) — money collected, players enrolled, coaching hours delivered,
// matches played, and so on. No manual entry, so it's always current.
export default async function StatsPage() {
  await requireAdmin();
  const { groups, seasonNames, coachLeaderboard, ratings } = await academyStats();

  const maxHours = coachLeaderboard.reduce((m, c) => Math.max(m, c.hours), 0);
  const totalStars = ratings.dist.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stats"
        subtitle={
          seasonNames.length
            ? `Live totals across ${seasonNames.join(" · ")}.`
            : "Live totals for the active season."
        }
      />

      {groups.length === 0 ? (
        <div className="card text-center text-slate-400">
          No active season yet — stats appear once a season is live.
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.title} className="card">
              <h2 className="mb-3 font-semibold text-slate-900">{g.title}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.stats.map((s) => (
                  <div key={s.label} className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
                    <div className="mt-1 text-2xl font-extrabold text-slate-900">{s.value}</div>
                    {s.sub && <div className="mt-0.5 text-[11px] text-slate-400">{s.sub}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Coach hours leaderboard */}
          <div className="card">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Coaching hours leaderboard</h2>
              <span className="text-xs text-slate-400">Delivered-session hours, per coach</span>
            </div>
            {coachLeaderboard.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No delivered sessions with a coach assigned yet.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {coachLeaderboard.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-right text-sm font-semibold text-slate-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{c.name}</span>
                        <span className="whitespace-nowrap text-sm font-semibold text-slate-900">
                          {c.hours} hr<span className="ml-2 font-normal text-slate-400">{c.sessions} session{c.sessions === 1 ? "" : "s"}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${maxHours ? (c.hours / maxHours) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Ratings & reviews */}
          <div className="card">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Ratings &amp; reviews</h2>
              <Link href="/console/feedback" className="text-xs font-semibold text-brand-600 hover:text-brand-800 hover:underline">
                Read {ratings.reviews === 1 ? "the review" : "all reviews"} →
              </Link>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-[auto,1fr] sm:items-center">
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-4xl font-extrabold text-slate-900">{ratings.count ? ratings.avg.toFixed(1) : "—"}</div>
                  <div className="text-xs text-slate-400">avg of {ratings.count} rating{ratings.count === 1 ? "" : "s"}</div>
                </div>
                <div className="text-2xl leading-none text-amber-400" aria-hidden>
                  {"★★★★★".slice(0, Math.round(ratings.avg))}
                  <span className="text-slate-200">{"★★★★★".slice(Math.round(ratings.avg))}</span>
                </div>
              </div>
              <div className="space-y-1">
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = ratings.dist[star - 1];
                  const pct = totalStars ? (n / totalStars) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-8 whitespace-nowrap">{star} ★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-6 text-right tabular-nums">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Link href="/console/feedback" className="rounded-lg border border-slate-200 p-3 hover:border-brand-300 hover:bg-brand-50/40">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Written reviews</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{ratings.reviews}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-brand-600">Read them →</div>
              </Link>
              <Link href="/console/feedback" className="rounded-lg border border-slate-200 p-3 hover:border-brand-300 hover:bg-brand-50/40">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Testimonials published</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{ratings.published}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-brand-600">Manage →</div>
              </Link>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Ratings given</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{ratings.count}</div>
              </div>
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-slate-400">
        Everything here is computed live from registrations, payments, sessions, attendance, league
        results and family feedback — no manual entry. Coaching hours count each delivered session&apos;s
        length once per coach on it (two coaches on a 90-minute practice = 3 hours), so the leaderboard
        adds up to the total.
      </p>
    </div>
  );
}
