import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isStaff, isAdmin } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { formatCents } from "@/lib/money";
import { garmentLabel, sizeLabel } from "@/lib/domain/apparel";
import { computeEnrollmentBreakdown } from "@/lib/domain/enrollmentBreakdown";
import { teamAssignmentReport, waitlistReport } from "@/lib/domain/rosterReports";
import { pnlRange, pnlSeasonByMonth, monthLabel, today, type PnlBasis } from "@/lib/domain/pnl";
import { seasonTeamPnls } from "@/lib/domain/reportingData";

// Dollars as a plain number (no $ or thousands separator) so the CSV is ready
// for spreadsheet math.
const usd = (cents: number) => (cents / 100).toFixed(2);
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

// CSV export for the key registers (§18). Staff only.
export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const session = await getSession();
  if (!session || !isStaff(session.role)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { dataset } = await params;
  const admin = isAdmin(session.roles ?? session.role);
  const sp = new URL(req.url).searchParams;

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
    case "apparel": {
      const items = await prisma.apparelOrderItem.findMany({
        include: { payment: { include: { party: true } } },
        orderBy: { createdAt: "desc" },
      });
      const personIds = [...new Set(items.map((i) => i.personId).filter(Boolean) as string[])];
      const people = personIds.length
        ? await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true } })
        : [];
      const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
      return csvResponse("apparel-orders.csv", toCsv(items.map((i) => ({
        garment: garmentLabel(i.garment),
        size: sizeLabel(i.size),
        quantity: i.quantity,
        unitPrice: formatCents(i.unitPriceCents),
        player: i.personId ? nameOf.get(i.personId) ?? "" : "",
        payer: i.payment.party ? `${i.payment.party.firstName} ${i.payment.party.lastName}` : "",
        paymentStatus: i.payment.status,
        fulfillment: i.fulfillment,
        orderedAt: i.createdAt,
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
    case "enrollment-breakdown": {
      // Admins only — same audience as the dashboard section it exports.
      if (!isAdmin(session.roles ?? session.role)) return new Response("Unauthorized", { status: 401 });
      const regs = await prisma.registration.findMany({
        select: {
          status: true,
          programInterest: true,
          skillLevel: true,
          division: { select: { name: true } },
          locationPrefs: { select: { marketName: true, facility: { select: { name: true, market: true } } } },
        },
      });
      const b = computeEnrollmentBreakdown(regs);
      const rows = [
        ...b.byLocation.map((r) => ({ category: "Location", label: r.label, active: r.active, waitlist: r.waitlist, total: r.total })),
        ...b.byProgram.map((r) => ({ category: "Program / skill level", label: r.label, active: r.active, waitlist: r.waitlist, total: r.total })),
      ];
      return csvResponse("enrollment-breakdown.csv", toCsv(rows, ["category", "label", "active", "waitlist", "total"]));
    }
    case "assignments": {
      const rows = await teamAssignmentReport();
      return csvResponse("team-assignments.csv", toCsv(rows.map((r) => ({
        player: r.player, team: r.team, division: r.division, coach: r.coach,
        location: r.location, dayTime: r.dayTime, waiver: r.waiver, fee: r.fee,
        email: r.email, phone: r.phone,
      })), ["player", "team", "division", "coach", "location", "dayTime", "waiver", "fee", "email", "phone"]));
    }
    case "waitlist": {
      const rows = await waitlistReport();
      return csvResponse("waitlist.csv", toCsv(rows.map((r) => ({
        team: r.team, position: r.position, player: r.player, status: r.status,
        addedAt: r.addedAt, note: r.note ?? "", email: r.email, phone: r.phone,
      })), ["team", "position", "player", "status", "addedAt", "note", "email", "phone"]));
    }
    case "pnl": {
      // The P&L statement for a date range + basis (mirrors /console/pnl). Admin only.
      if (!admin) return new Response("Unauthorized", { status: 401 });
      const basis: PnlBasis = sp.get("basis") === "booked" ? "booked" : "forecast";
      const from = dayRe.test(sp.get("from") ?? "") ? sp.get("from")! : today();
      const to = dayRe.test(sp.get("to") ?? "") ? sp.get("to")! : today();
      const pnl = await pnlRange(from, to, basis);
      const t = pnl.totals;
      // Booked basis shows only ACTUAL manual lines, same as the page.
      const revLines = basis === "booked" ? pnl.revenue.filter((r) => r.kind === "ACTUAL") : pnl.revenue;
      const expLines = basis === "booked" ? pnl.expenses.filter((r) => r.kind === "ACTUAL") : pnl.expenses;
      type Row = { section: string; line: string; amount: string; note: string };
      const rows: Row[] = [];
      rows.push({ section: "Statement", line: "Basis", amount: "", note: basis });
      rows.push({ section: "Statement", line: "Date range", amount: "", note: `${from} to ${to}` });
      rows.push({ section: "Statement", line: "Generated", amount: "", note: new Date().toISOString() });
      // Revenue
      rows.push({ section: "Revenue", line: "Booked revenue (collected)", amount: usd(pnl.auto.bookedCents), note: "" });
      if (basis === "forecast" && pnl.auto.installmentCents > 0) rows.push({ section: "Revenue", line: "Subscription installments (scheduled)", amount: usd(pnl.auto.installmentCents), note: "" });
      if (basis === "forecast" && pnl.auto.unpaidFeeCents > 0) rows.push({ section: "Revenue", line: "Unpaid fees — assigned players", amount: usd(pnl.auto.unpaidFeeCents), note: "" });
      for (const r of revLines) rows.push({ section: "Revenue", line: r.label, amount: usd(r.amountCents), note: `${r.kind.toLowerCase()} · ${monthLabel(r.month)}` });
      rows.push({ section: "Revenue", line: "TOTAL REVENUE", amount: usd(t.revenue), note: "" });
      // Expenses (coach + court are auto)
      for (const c of pnl.auto.coaches) rows.push({ section: "Expenses", line: `Coach — ${c.name}`, amount: usd(c.cents), note: "auto" });
      for (const c of pnl.auto.courtCosts) rows.push({ section: "Expenses", line: `Court — ${c.facilityName}`, amount: usd(c.cents), note: "auto" });
      for (const r of expLines) rows.push({ section: "Expenses", line: r.label, amount: usd(r.amountCents), note: `${r.kind.toLowerCase()} · ${monthLabel(r.month)}` });
      rows.push({ section: "Expenses", line: "TOTAL EXPENSES", amount: usd(t.expenses), note: "" });
      // Bottom line
      rows.push({ section: "Bottom line", line: "Net income", amount: usd(t.netIncome), note: "revenue − expenses" });
      rows.push({ section: "Bottom line", line: `Director's pay (${+(t.directorPct * 100).toFixed(2)}% of net)`, amount: usd(t.directorPayCents), note: "" });
      rows.push({ section: "Bottom line", line: "Net to PURE", amount: usd(t.netToPureCents), note: "" });
      return csvResponse(`pnl-${basis}-${from}_to_${to}.csv`, toCsv(rows, ["section", "line", "amount", "note"]));
    }
    case "pnl-season": {
      // Month-by-month season breakdown, BOTH bases. Admin only.
      if (!admin) return new Response("Unauthorized", { status: 401 });
      const season =
        (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { startDate: true, endDate: true } })) ??
        (await prisma.season.findFirst({ where: { active: true }, select: { startDate: true, endDate: true } }));
      const months: string[] = [];
      if (season) {
        let y = season.startDate.getUTCFullYear(), m = season.startDate.getUTCMonth();
        const ey = season.endDate.getUTCFullYear(), em = season.endDate.getUTCMonth();
        while ((y < ey || (y === ey && m <= em)) && months.length < 24) {
          months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
          m++; if (m > 11) { m = 0; y++; }
        }
      }
      const monthly = months.length ? await pnlSeasonByMonth(months) : [];
      const rows = monthly.map((r) => ({
        month: monthLabel(r.month),
        bookedRevenue: usd(r.bookedRevenueCents), bookedExpenses: usd(r.actualExpenseCents), bookedNet: usd(r.bookedNetCents), bookedDirectorPay: usd(r.bookedDirectorCents), bookedNetToPure: usd(r.bookedNetToPureCents),
        forecastRevenue: usd(r.forecastRevenueCents), forecastExpenses: usd(r.forecastExpenseCents), forecastNet: usd(r.forecastNetCents), forecastDirectorPay: usd(r.forecastDirectorCents), forecastNetToPure: usd(r.forecastNetToPureCents),
        forecastInstallments: usd(r.installmentCents), forecastUnpaidFees: usd(r.unpaidFeeCents),
      }));
      const cols = ["month", "bookedRevenue", "bookedExpenses", "bookedNet", "bookedDirectorPay", "bookedNetToPure", "forecastRevenue", "forecastExpenses", "forecastNet", "forecastDirectorPay", "forecastNetToPure", "forecastInstallments", "forecastUnpaidFees"];
      if (monthly.length) {
        const sum = (pick: (r: (typeof monthly)[number]) => number) => monthly.reduce((s, r) => s + pick(r), 0);
        rows.push({
          month: "SEASON TOTAL",
          bookedRevenue: usd(sum((r) => r.bookedRevenueCents)), bookedExpenses: usd(sum((r) => r.actualExpenseCents)), bookedNet: usd(sum((r) => r.bookedNetCents)), bookedDirectorPay: usd(sum((r) => r.bookedDirectorCents)), bookedNetToPure: usd(sum((r) => r.bookedNetToPureCents)),
          forecastRevenue: usd(sum((r) => r.forecastRevenueCents)), forecastExpenses: usd(sum((r) => r.forecastExpenseCents)), forecastNet: usd(sum((r) => r.forecastNetCents)), forecastDirectorPay: usd(sum((r) => r.forecastDirectorCents)), forecastNetToPure: usd(sum((r) => r.forecastNetToPureCents)),
          forecastInstallments: usd(sum((r) => r.installmentCents)), forecastUnpaidFees: usd(sum((r) => r.unpaidFeeCents)),
        });
      }
      return csvResponse("pnl-season-breakdown.csv", toCsv(rows, cols));
    }
    case "pnl-teams": {
      // Per-team season P&L (contribution) — matches the Reports page table.
      if (!admin) return new Response("Unauthorized", { status: 401 });
      const pnls = await seasonTeamPnls();
      const rows = pnls.map((p) => ({
        team: p.teamName,
        revenue: usd(p.revenueCents),
        coachCost: usd(p.coachCostCents),
        courtCost: usd(p.courtCostCents),
        contribution: usd(p.contributionCents),
      }));
      if (pnls.length) {
        rows.push({
          team: "TOTAL",
          revenue: usd(pnls.reduce((s, p) => s + p.revenueCents, 0)),
          coachCost: usd(pnls.reduce((s, p) => s + p.coachCostCents, 0)),
          courtCost: usd(pnls.reduce((s, p) => s + p.courtCostCents, 0)),
          contribution: usd(pnls.reduce((s, p) => s + p.contributionCents, 0)),
        });
      }
      return csvResponse("pnl-by-team.csv", toCsv(rows, ["team", "revenue", "coachCost", "courtCost", "contribution"]));
    }
    default:
      return new Response("Unknown dataset", { status: 404 });
  }
}
