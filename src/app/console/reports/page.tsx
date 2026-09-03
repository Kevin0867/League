import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatCents } from "@/lib/money";
import { teamContribution, completionRate, type TeamPnL } from "@/lib/domain/reporting";
import type { FacilityRates, DeliveredSession } from "@/lib/domain/finance";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { formatTime12 } from "@/lib/time";
import { requireAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// Weekday order so the coaching grid reads Mon→Sun, not alphabetically.
const DAY_ORDER: Record<string, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };
const DAY_LABEL: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

type CoachRow = {
  coach: string;
  coachId: string | null;
  team: string;
  teamId: string;
  division: string;
  location: string;
  daySort: number;
  dayTime: string;
  role: "Head" | "Assistant";
};

export default async function ReportsPage() {
  await requireAdmin();
  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } });

  // ---- Who's coaching what, where, when ----
  const coachingTeams = await prisma.team.findMany({
    where: season ? { seasonId: season.id, isTest: false } : { isTest: false },
    include: {
      facility: { select: { name: true } },
      division: { select: { name: true } },
      coach: { include: { person: { select: { id: true, firstName: true, lastName: true } } } },
      assistantCoaches: { include: { coach: { include: { person: { select: { id: true, firstName: true, lastName: true } } } } } },
    },
    orderBy: { name: "asc" },
  });

  const coachingRows: CoachRow[] = [];
  let teamsNeedingCoach = 0;
  for (const t of coachingTeams) {
    if (!t.coachId) teamsNeedingCoach++;
    const base = {
      team: t.name,
      teamId: t.id,
      division: t.division?.name ?? t.divisionCode ?? "—",
      location: t.facility?.name ?? "—",
      daySort: t.dayOfWeek ? DAY_ORDER[t.dayOfWeek] ?? 99 : 99,
      dayTime: t.dayOfWeek ? `${DAY_LABEL[t.dayOfWeek] ?? t.dayOfWeek} ${formatTime12(t.startTime)}` : "—",
    };
    if (t.coach) {
      coachingRows.push({ ...base, coach: `${t.coach.person.firstName} ${t.coach.person.lastName}`, coachId: t.coach.person.id, role: "Head" });
    }
    for (const ac of t.assistantCoaches) {
      coachingRows.push({ ...base, coach: `${ac.coach.person.firstName} ${ac.coach.person.lastName}`, coachId: ac.coach.person.id, role: "Assistant" });
    }
  }
  // Sort by coach name, then by day/time within a coach.
  coachingRows.sort((a, b) => a.coach.localeCompare(b.coach) || a.daySort - b.daySort || a.team.localeCompare(b.team));
  const distinctCoaches = new Set(coachingRows.map((r) => r.coach)).size;

  // ---- Retention funnel (§16) ----
  // "Paid" splits two ways: paid IN FULL, and ON PLAN — a 3-payment subscription
  // that's begun (first installment cleared) and is in good standing. Both are
  // paying customers; keeping them separate shows fully-settled vs. still-billing.
  const [registered, assigned, paidCount, subCount, attendedPeople] = await Promise.all([
    prisma.registration.count({ where: season ? { seasonId: season.id } : {} }),
    prisma.registration.count({ where: { status: "ASSIGNED", ...(season ? { seasonId: season.id } : {}) } }),
    prisma.payment.count({ where: { category: "PLAYER_FEE", status: "PAID", ...(season ? { seasonId: season.id } : {}) } }),
    prisma.payment.count({ where: { category: "PLAYER_FEE", installmentPlan: true, status: "PENDING", installmentsPaid: { gte: 1 }, ...(season ? { seasonId: season.id } : {}) } }),
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
    // Revenue is cash actually collected: fees paid in full, PLUS the collected
    // portion of active subscriptions (per-installment × installments cleared).
    // A subscription-heavy team no longer reads $0 — it earns credit as each
    // 30-day charge lands.
    let revenue = 0;
    if (memberIds.length) {
      const pays = await prisma.payment.findMany({
        where: {
          partyId: { in: memberIds },
          category: "PLAYER_FEE",
          OR: [{ status: "PAID" }, { installmentPlan: true, status: "PENDING", installmentsPaid: { gte: 1 } }],
        },
        select: { amountCents: true, status: true, installmentsPaid: true, installmentsTotal: true },
      });
      for (const p of pays) {
        if (p.status === "PAID") {
          revenue += p.amountCents;
        } else {
          const total = p.installmentsTotal ?? 3;
          const perCharge = Math.round(p.amountCents / total); // matches Stripe's per-installment charge
          revenue += perCharge * (p.installmentsPaid ?? 0);
        }
      }
    }

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

      {/* Coaching assignments — who coaches what, where, when */}
      <div className="card overflow-x-auto">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Coaching assignments</h2>
          <span className="text-xs text-slate-400">
            {distinctCoaches} coach{distinctCoaches === 1 ? "" : "es"} · {coachingRows.length} assignment{coachingRows.length === 1 ? "" : "s"}
            {teamsNeedingCoach > 0 ? (
              <> · <Link href="/console/teams" className="font-medium text-amber-700 hover:underline">{teamsNeedingCoach} team{teamsNeedingCoach === 1 ? "" : "s"} still need a head coach</Link></>
            ) : ""}
          </span>
        </div>
        <p className="mb-3 text-sm text-slate-500">Every coach and the teams they run this season — with location and practice day &amp; time.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Coach</th>
              <th>Team</th>
              <th>Division</th>
              <th>Location</th>
              <th>Day &amp; time</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {coachingRows.map((r, i) => {
              const firstOfCoach = i === 0 || coachingRows[i - 1].coach !== r.coach;
              return (
                <tr key={`${r.coachId}-${r.teamId}-${r.role}`}>
                  <td className="py-2 font-medium text-slate-800">
                    {firstOfCoach ? (
                      r.coachId ? (
                        <Link href={`/console/coaches/${r.coachId}`} className="hover:text-brand-700 hover:underline">{r.coach}</Link>
                      ) : r.coach
                    ) : (
                      <span className="text-slate-300">↳</span>
                    )}
                  </td>
                  <td className="text-slate-700">
                    <Link href={`/console/teams/${r.teamId}`} className="hover:text-brand-700 hover:underline">{r.team}</Link>
                  </td>
                  <td className="text-slate-500">{r.division}</td>
                  <td className="text-slate-500">{r.location}</td>
                  <td className="text-slate-600">{r.dayTime}</td>
                  <td>
                    <span className={`badge ${r.role === "Head" ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}`}>{r.role}</span>
                  </td>
                </tr>
              );
            })}
            {coachingRows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-slate-400">No coaches assigned to teams yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Retention */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Retention funnel</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Funnel label="Registered" value={registered} />
          <Funnel label="Assigned" value={assigned} pct={registered ? assigned / registered : 0} />
          <Funnel label="Paid in full" value={paidCount} pct={registered ? paidCount / registered : 0} tone="emerald" />
          <Funnel label="On plan" value={subCount} pct={registered ? subCount / registered : 0} tone="emerald" sub="subscriptions, paying" />
          <Funnel label="Attended ≥1" value={attended} pct={rate} />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {paidCount + subCount} paying ({paidCount} paid in full, {subCount} on the 3-payment plan and in good standing).
          Registration-to-completion proxy: {(rate * 100).toFixed(0)}%. Season-to-season return rates
          populate once a second season is on record.
        </p>
      </div>

      {/* Season P&L */}
      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold text-slate-900">Season P&amp;L by team</h2>
        {pnls.length > 0 && totals.revenue === 0 && (
          <p className="mb-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No season fees marked paid yet, so revenue reads $0 across the board. It fills in as
            payments land — request fees from{" "}
            <Link href="/console/payments" className="font-medium text-brand-700 hover:underline">Payments</Link>{" "}
            or a registration row.
          </p>
        )}
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
        <p className="mt-3 text-xs text-slate-400">
          Revenue is cash collected to date — fees paid in full plus the cleared installments of
          active 3-payment subscriptions. The remaining scheduled installments are counted as they charge.
        </p>
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

function Funnel({ label, value, pct, tone, sub }: { label: string; value: number; pct?: number; tone?: "emerald"; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone === "emerald" ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
      {pct !== undefined && <div className="text-xs text-slate-500">{(pct * 100).toFixed(0)}% of registered</div>}
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
