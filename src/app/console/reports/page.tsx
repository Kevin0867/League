import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatCents } from "@/lib/money";
import { teamContribution, completionRate, type TeamPnL } from "@/lib/domain/reporting";
import type { FacilityRates, DeliveredSession } from "@/lib/domain/finance";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { requireAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireAdmin();
  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } });

  // ---- Retention funnel (§16) ----
  const [registered, assigned, paidCount, attendedPeople] = await Promise.all([
    prisma.registration.count({ where: season ? { seasonId: season.id } : {} }),
    prisma.registration.count({ where: { status: "ASSIGNED", ...(season ? { seasonId: season.id } : {}) } }),
    prisma.payment.count({ where: { category: "PLAYER_FEE", status: "PAID", ...(season ? { seasonId: season.id } : {}) } }),
    prisma.attendance.findMany({ where: { status: "PRESENT" }, distinct: ["personId"], select: { personId: true } }),
  ]);
  const attended = attendedPeople.length;
  const rate = completionRate(registered, attended);

  // ---- Season P&L per team (§16) ----
  const teams = await prisma.team.findMany({
    where: season ? { seasonId: season.id, origin: "PURE_ACADEMY" } : { origin: "PURE_ACADEMY" },
    include: {
      facility: true,
      members: { select: { personId: true } },
      sessions: { include: { session: true } },
    },
  });

  const pnls: TeamPnL[] = [];
  for (const t of teams) {
    const memberIds = t.members.map((m) => m.personId);
    const revenue = memberIds.length
      ? (await prisma.payment.aggregate({
          where: { partyId: { in: memberIds }, category: "PLAYER_FEE", status: "PAID" },
          _sum: { amountCents: true },
        }))._sum.amountCents ?? 0
      : 0;

    const delivered = t.sessions.map((st) => st.session).filter((s) => s.status === "DELIVERED");
    const coachCost = delivered.length * COACH_PER_SESSION_CENTS;
    const ds: DeliveredSession[] = delivered.map((s) => ({ courtCount: s.courtCount, startTime: s.startTime, endTime: s.endTime, date: s.date }));
    const rates: FacilityRates = t.facility
      ? { feeBasis: t.facility.feeBasis, weekdayRateCents: t.facility.weekdayRateCents, weekendRateCents: t.facility.weekendRateCents, percentageRate: t.facility.percentageRate }
      : { feeBasis: "NONE", weekdayRateCents: 0, weekendRateCents: 0, percentageRate: null };

    pnls.push(teamContribution(t.name, t.id, revenue, coachCost, ds, rates));
  }

  const totals = pnls.reduce(
    (a, p) => ({
      revenue: a.revenue + p.revenueCents,
      coach: a.coach + p.coachCostCents,
      court: a.court + p.courtCostCents,
      contribution: a.contribution + p.contributionCents,
    }),
    { revenue: 0, coach: 0, court: 0, contribution: 0 }
  );

  const EXPORTS = [
    ["registrations", "Registrations"],
    ["teams", "Teams"],
    ["payments", "Payments"],
    ["apparel", "Apparel orders"],
    ["payouts", "Coach payouts"],
    ["statements", "Facility statements"],
    ["1099", "Coach 1099 totals"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="The season is judged on retention; the month is judged on facility statements." />

      {/* Retention */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Retention funnel</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Funnel label="Registered" value={registered} />
          <Funnel label="Assigned" value={assigned} pct={registered ? assigned / registered : 0} />
          <Funnel label="Paid" value={paidCount} pct={registered ? paidCount / registered : 0} />
          <Funnel label="Attended ≥1" value={attended} pct={rate} />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Registration-to-completion proxy: {(rate * 100).toFixed(0)}%. Season-to-season return rates
          populate once a second season is on record.
        </p>
      </div>

      {/* Season P&L */}
      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold text-slate-900">Season P&amp;L by team</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr><th className="py-2">Team</th><th className="text-right">Revenue</th><th className="text-right">Coach cost</th><th className="text-right">Court cost</th><th className="text-right">Contribution</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pnls.map((p) => (
              <tr key={p.teamId}>
                <td className="py-2 font-medium text-slate-800">{p.teamName}</td>
                <td className="text-right text-slate-600">{formatCents(p.revenueCents)}</td>
                <td className="text-right text-slate-600">{formatCents(p.coachCostCents)}</td>
                <td className="text-right text-slate-600">{formatCents(p.courtCostCents)}</td>
                <td className={`text-right font-semibold ${p.contributionCents >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(p.contributionCents)}</td>
              </tr>
            ))}
            {pnls.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">No teams yet.</td></tr>}
          </tbody>
          {pnls.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold">
                <td className="py-2">Total</td>
                <td className="text-right">{formatCents(totals.revenue)}</td>
                <td className="text-right">{formatCents(totals.coach)}</td>
                <td className="text-right">{formatCents(totals.court)}</td>
                <td className={`text-right ${totals.contribution >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(totals.contribution)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* CSV exports */}
      <div className="card">
        <h2 className="mb-1 font-semibold text-slate-900">Export to CSV</h2>
        <p className="mb-3 text-sm text-slate-500">Everything is exportable — next season may be built differently.</p>
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map(([ds, label]) => (
            <a key={ds} href={`/console/export/${ds}`} className="btn-secondary text-sm">↓ {label}</a>
          ))}
        </div>
      </div>

      {/* Live report links */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { title: "Team build board", href: "/console/teams" },
          { title: "Facility agreement tracker", href: "/console/facilities" },
          { title: "Compliance dashboard", href: "/console/compliance" },
          { title: "Coach payout register", href: "/console/payments" },
          { title: "Monthly facility statements", href: "/console/payments" },
          { title: "Public standings", href: "/standings" },
        ].map((r) => (
          <Link key={r.title} href={r.href} className="card hover:shadow-md">
            <span className="badge bg-emerald-100 text-emerald-800">Live</span>
            <h3 className="mt-2 font-semibold text-slate-900">{r.title}</h3>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Funnel({ label, value, pct }: { label: string; value: number; pct?: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-slate-900">{value}</div>
      {pct !== undefined && <div className="text-xs text-slate-500">{(pct * 100).toFixed(0)}% of registered</div>}
    </div>
  );
}
