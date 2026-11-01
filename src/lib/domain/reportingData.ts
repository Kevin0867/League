import "server-only";
import { prisma } from "@/lib/db";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { teamContribution, type TeamPnL } from "./reporting";
import type { FacilityRates, DeliveredSession } from "./finance";

// Per-team season P&L (contribution) for the active PURE Academy season — the
// exact computation the Reports page shows, lifted into one place so the page and
// the CSV export can never drift. Revenue is cash collected to date: fees paid in
// full PLUS the cleared installments of active 3-payment plans.
export async function seasonTeamPnls(): Promise<TeamPnL[]> {
  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } });
  const teams = await prisma.team.findMany({
    where: season ? { seasonId: season.id, origin: "PURE_ACADEMY" } : { origin: "PURE_ACADEMY" },
    include: { facility: true, members: { select: { personId: true } }, sessions: { include: { session: true } } },
  });

  const pnls: TeamPnL[] = [];
  for (const t of teams) {
    const memberIds = t.members.map((m) => m.personId);
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
          const perCharge = Math.round(p.amountCents / total);
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
  return pnls;
}
