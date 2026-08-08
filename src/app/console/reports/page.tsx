import { PageHeader } from "@/components/RoadmapNote";

const REPORTS = [
  { title: "Team build board", body: "Every team's six fields and completion status.", phase: "Live", href: "/console/teams" },
  { title: "Facility agreement tracker", body: "Status, next action, contact.", phase: "Live", href: "/console/facilities" },
  { title: "Compliance dashboard", body: "Waivers, background checks, certifications, media opt-outs.", phase: "Live", href: "/console/compliance" },
  { title: "Monthly facility statements", body: "One per facility — on-site practice revenue and payment due.", phase: "Phase 2" },
  { title: "Coach payout register", body: "Sessions, à la carte, totals, year-to-date.", phase: "Phase 2" },
  { title: "Season P&L", body: "Revenue by team, coach cost, court cost, contribution.", phase: "Phase 3" },
  { title: "Retention", body: "Registration-to-completion and season-to-season return rates.", phase: "Phase 3" },
  { title: "Year-end 1099 totals", body: "Contractor totals for coaches at year end.", phase: "Phase 4" },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="The season is judged on retention; the month is judged on facility statements." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const inner = (
            <div className="card h-full">
              <div className="mb-2 flex items-center justify-between">
                <span className={`badge ${r.phase === "Live" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{r.phase}</span>
              </div>
              <h3 className="font-semibold text-slate-900">{r.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{r.body}</p>
            </div>
          );
          return r.href ? <a key={r.title} href={r.href}>{inner}</a> : <div key={r.title}>{inner}</div>;
        })}
      </div>
      <p className="text-sm text-slate-500">Export everything to CSV — whatever is built this season, next season may be built differently (§18).</p>
    </div>
  );
}
