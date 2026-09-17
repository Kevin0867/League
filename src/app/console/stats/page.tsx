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
  const { groups, seasonNames } = await academyStats();

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
        groups.map((g) => (
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
        ))
      )}

      <p className="text-xs text-slate-400">
        Everything here is computed live from registrations, payments, sessions, attendance and league
        results — no manual entry. Coaching hours count each delivered session&apos;s length once per coach
        on it (two coaches on a 90-minute practice = 3 hours).
      </p>
    </div>
  );
}
