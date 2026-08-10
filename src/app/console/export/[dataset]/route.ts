import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { formatCents } from "@/lib/money";

// CSV export for the key registers (§18). Staff only.
export async function GET(_req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const session = await getSession();
  if (!session || !isStaff(session.role)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { dataset } = await params;

  switch (dataset) {
    case "registrations": {
      const regs = await prisma.registration.findMany({ include: { person: true, division: true } });
      return csvResponse("registrations.csv", toCsv(regs.map((r) => ({
        firstName: r.person.firstName, lastName: r.person.lastName,
        email: r.person.email, phone: r.person.phone,
        division: r.division?.name, status: r.status,
        duprId: r.person.duprId, duprVerified: r.person.duprVerified,
        waiverSigned: r.person.waiverSignedAt ? "yes" : "no",
        mediaOptOut: r.mediaOptOut, submittedAt: r.submittedAt,
      }))));
    }
    case "teams": {
      const teams = await prisma.team.findMany({ include: { division: true, facility: true, coach: { include: { person: true } }, _count: { select: { members: true } } } });
      return csvResponse("teams.csv", toCsv(teams.map((t) => ({
        name: t.name, origin: t.origin, division: t.division?.name, levelBand: t.levelBand,
        market: t.market, coach: t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : "",
        facility: t.facility?.name, day: t.dayOfWeek, time: t.startTime,
        roster: t._count.members, published: t.published, forfeits: t.forfeitCount, champEligible: t.champEligible,
      }))));
    }
    case "payments": {
      const pays = await prisma.payment.findMany({ include: { party: true } });
      return csvResponse("payments.csv", toCsv(pays.map((p) => ({
        direction: p.direction, category: p.category, status: p.status,
        party: p.party ? `${p.party.firstName} ${p.party.lastName}` : "",
        amount: formatCents(p.amountCents), method: p.method,
        description: p.description, paidAt: p.paidAt, createdAt: p.createdAt,
      }))));
    }
    case "payouts": {
      const lines = await prisma.coachPayoutLine.findMany({ include: { coach: { include: { person: true } }, payoutRun: true } });
      return csvResponse("coach-payouts.csv", toCsv(lines.map((l) => ({
        coach: `${l.coach.person.firstName} ${l.coach.person.lastName}`,
        periodStart: l.payoutRun.periodStart, periodEnd: l.payoutRun.periodEnd,
        sessionsDelivered: l.sessionsDelivered,
        sessionPay: formatCents(l.sessionPayCents), alaCarte: formatCents(l.alaCarteCents),
        total: formatCents(l.totalCents), status: l.payoutRun.status,
      }))));
    }
    case "statements": {
      const st = await prisma.facilityStatement.findMany({ include: { facility: true } });
      return csvResponse("facility-statements.csv", toCsv(st.map((s) => ({
        facility: s.facility.name, feeBasis: s.facility.feeBasis,
        periodStart: s.periodStart, periodEnd: s.periodEnd,
        sessionsDelivered: s.sessionsDelivered,
        onSiteRevenue: formatCents(s.onSiteRevenueCents), amountDue: formatCents(s.amountDueCents),
        status: s.status,
      }))));
    }
    case "1099": {
      // Year-end contractor totals (§9, Phase 4) — coach payout totals to date.
      const coaches = await prisma.coach.findMany({ include: { person: true, payouts: true } });
      return csvResponse("coach-1099-totals.csv", toCsv(coaches.map((c) => ({
        coach: `${c.person.firstName} ${c.person.lastName}`,
        totalPaid: formatCents(c.payouts.reduce((s, l) => s + l.totalCents, 0)),
      }))));
    }
    default:
      return new Response("Unknown dataset", { status: 404 });
  }
}
