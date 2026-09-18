import "server-only";
import { prisma } from "@/lib/db";
import { installmentChargeDates } from "@/lib/payments/receipt";
import { phoenixDateInput } from "@/lib/time";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { isSessionComplete } from "@/lib/domain/coachPay";
import { stripeChargesSince, paymentsSince } from "@/lib/payments/reconcile";

// P&L model. Two kinds of numbers:
//   • AUTO, computed live from real data — booked revenue (cash actually
//     collected in the month) and scheduled coach cost (delivered/again-scheduled
//     practices × the per-session rate). Read-only.
//   • MANUAL PnlEntry rows the admin edits — extra revenue and every expense,
//     plus FORECAST projection rows.
// Booked revenue is the point of the ask: a subscription's PAID installment
// counts in the month it cleared; its unpaid installments show as FORECAST in
// their scheduled months — never as this month's revenue.

const monthOf = (d: Date) => phoenixDateInput(d).slice(0, 7); // "YYYY-MM" in Phoenix
export const thisMonth = () => phoenixDateInput(new Date()).slice(0, 7);

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type MonthAuto = { bookedCents: number; forecastCents: number; coachCostCents: number };
export type PnlEntryRow = { id: string; section: string; label: string; amountCents: number; kind: string; note: string | null };

type Contribution = { day: string; bucket: "booked" | "forecast"; cents: number };

/**
 * Every revenue contribution, tagged by Phoenix day and booked-vs-forecast.
 *   • BOOKED (collected) comes from the SAME source as the Payments "Collected"
 *     figure — live Stripe charges net of refunds since the collection start,
 *     plus offline (manual) payments — so the P&L and Payments always agree.
 *     Falls back to app records if Stripe isn't configured.
 *   • FORECAST is always from app records (Stripe can't see the future): a
 *     subscription's unpaid installments at their scheduled dates, and
 *     outstanding one-time fees.
 * Booked already includes apparel (it's part of each Stripe charge) and is net
 * of refunds, which is why summing this equals the Payments total.
 */
async function revenueContributions(): Promise<Contribution[]> {
  const { unix: sinceUnix } = paymentsSince();
  const day = (d: Date) => phoenixDateInput(d);
  const out: Contribution[] = [];

  const [charges, pays, manual] = await Promise.all([
    stripeChargesSince(sinceUnix).catch(() => null),
    prisma.payment.findMany({
      where: { direction: "IN", status: { in: ["PAID", "PENDING", "REQUESTED"] }, category: { not: "REFUND" } },
      select: { amountCents: true, status: true, paidAt: true, createdAt: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true },
    }),
    prisma.payment.findMany({ where: { direction: "IN", status: "PAID", method: "MANUAL", category: { not: "REFUND" } }, select: { amountCents: true, paidAt: true, createdAt: true } }),
  ]);

  // ── Booked ────────────────────────────────────────────────────────────────
  if (charges) {
    // Authoritative: Stripe charges (net of refunds), by the day they cleared.
    for (const c of charges) out.push({ day: day(new Date(c.created * 1000)), bucket: "booked", cents: c.netCents });
    // Offline payments never touch Stripe — fold them in, like the Payments page.
    for (const p of manual) out.push({ day: day(p.paidAt ?? p.createdAt), bucket: "booked", cents: p.amountCents });
  } else {
    // Stripe not configured — reconstruct from app records: paid fees + paid
    // installments + apparel, net of recorded refunds.
    const [apparel, refunds] = await Promise.all([
      prisma.apparelOrderItem.findMany({ where: { payment: { direction: "IN", status: "PAID" } }, select: { unitPriceCents: true, quantity: true, payment: { select: { paidAt: true, createdAt: true } } } }),
      prisma.payment.findMany({ where: { direction: "OUT", category: "REFUND", status: "PAID" }, select: { amountCents: true, paidAt: true, createdAt: true } }),
    ]);
    for (const p of pays) {
      if (p.installmentPlan) {
        const total = p.installmentsTotal ?? 3;
        const per = Math.round(p.amountCents / total);
        const dates = installmentChargeDates(p.createdAt);
        for (let i = 0; i < (p.installmentsPaid ?? 0); i++) out.push({ day: day(dates[i] ?? p.createdAt), bucket: "booked", cents: per });
      } else if (p.status === "PAID") {
        out.push({ day: day(p.paidAt ?? p.createdAt), bucket: "booked", cents: p.amountCents });
      }
    }
    for (const a of apparel) out.push({ day: day(a.payment.paidAt ?? a.payment.createdAt), bucket: "booked", cents: a.unitPriceCents * a.quantity });
    for (const r of refunds) out.push({ day: day(r.paidAt ?? r.createdAt), bucket: "booked", cents: -r.amountCents });
  }

  // ── Forecast (always from app records) ──────────────────────────────────────
  for (const p of pays) {
    if (p.installmentPlan) {
      const total = p.installmentsTotal ?? 3;
      const per = Math.round(p.amountCents / total);
      const dates = installmentChargeDates(p.createdAt);
      for (let i = p.installmentsPaid ?? 0; i < total; i++) out.push({ day: day(dates[i] ?? p.createdAt), bucket: "forecast", cents: per });
    } else if (p.status !== "PAID") {
      out.push({ day: day(p.createdAt), bucket: "forecast", cents: p.amountCents });
    }
  }
  return out;
}

/** Revenue by Phoenix month, split into booked (collected) vs forecast. */
export async function revenueByMonth(): Promise<Map<string, { bookedCents: number; forecastCents: number }>> {
  const contribs = await revenueContributions();
  const m = new Map<string, { bookedCents: number; forecastCents: number }>();
  for (const c of contribs) {
    const month = c.day.slice(0, 7);
    const cur = m.get(month) ?? { bookedCents: 0, forecastCents: 0 };
    if (c.bucket === "booked") cur.bookedCents += c.cents; else cur.forecastCents += c.cents;
    m.set(month, cur);
  }
  return m;
}

/**
 * Booked (collected) and forecast revenue between two Phoenix calendar days
 * (inclusive, "YYYY-MM-DD") — matches the Payments "Collected" methodology, for
 * any window the admin chooses.
 */
export async function revenueBetween(fromDay: string, toDay: string): Promise<{ bookedCents: number; forecastCents: number }> {
  const contribs = await revenueContributions();
  let booked = 0, forecast = 0;
  for (const c of contribs) {
    if (c.day < fromDay || c.day > toDay) continue;
    if (c.bucket === "booked") booked += c.cents; else forecast += c.cents;
  }
  return { bookedCents: booked, forecastCents: forecast };
}

/** Delivered-practice coach session pay between two Phoenix days (inclusive). */
export async function coachCostBetween(fromDay: string, toDay: string): Promise<number> {
  const [rate, sessions] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true } }),
    prisma.session.findMany({ where: { type: "PRACTICE" }, select: { date: true, endTime: true, status: true, coaches: { select: { payable: true } } } }),
  ]);
  const per = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const now = new Date();
  let cost = 0;
  for (const s of sessions) {
    if (!isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now)) continue;
    const day = phoenixDateInput(s.date);
    if (day < fromDay || day > toDay) continue;
    cost += per * s.coaches.filter((c) => c.payable).length;
  }
  return cost;
}

/** Delivered/again-scheduled practice coach cost per month (auto expense seed). */
export async function coachCostByMonth(): Promise<Map<string, number>> {
  const [rate, sessions] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true } }),
    prisma.session.findMany({ where: { type: "PRACTICE" }, select: { date: true, endTime: true, status: true, coaches: { select: { payable: true } } } }),
  ]);
  const per = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const now = new Date();
  const m = new Map<string, number>();
  for (const s of sessions) {
    if (!isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now)) continue;
    const payableCount = s.coaches.filter((c) => c.payable).length;
    if (payableCount === 0) continue;
    const month = monthOf(s.date);
    m.set(month, (m.get(month) ?? 0) + per * payableCount);
  }
  return m;
}

export type PnlMonth = {
  month: string;
  auto: MonthAuto;
  revenue: PnlEntryRow[];
  expenses: PnlEntryRow[];
};

/** Full P&L: every relevant month with its auto figures and manual line items. */
export async function pnlModel(): Promise<{ months: PnlMonth[]; entries: PnlEntryRow[] }> {
  const [rev, coach, entriesRaw] = await Promise.all([
    revenueByMonth(),
    coachCostByMonth(),
    prisma.pnlEntry.findMany({ orderBy: [{ month: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);

  const monthSet = new Set<string>([thisMonth()]);
  for (const k of rev.keys()) monthSet.add(k);
  for (const k of coach.keys()) monthSet.add(k);
  for (const e of entriesRaw) monthSet.add(e.month);
  const months = [...monthSet].sort();

  const entries: PnlEntryRow[] = entriesRaw.map((e) => ({ id: e.id, section: e.section, label: e.label, amountCents: e.amountCents, kind: e.kind, note: e.note }));
  const byMonth = new Map<string, PnlEntryRow[]>();
  for (const e of entriesRaw) {
    const arr = byMonth.get(e.month) ?? [];
    arr.push({ id: e.id, section: e.section, label: e.label, amountCents: e.amountCents, kind: e.kind, note: e.note });
    byMonth.set(e.month, arr);
  }

  const out: PnlMonth[] = months.map((month) => {
    const r = rev.get(month) ?? { bookedCents: 0, forecastCents: 0 };
    const rows = byMonth.get(month) ?? [];
    return {
      month,
      auto: { bookedCents: r.bookedCents, forecastCents: r.forecastCents, coachCostCents: coach.get(month) ?? 0 },
      revenue: rows.filter((x) => x.section === "REVENUE"),
      expenses: rows.filter((x) => x.section === "EXPENSE"),
    };
  });
  return { months: out, entries };
}

/** Totals for one month. */
export function monthTotals(m: PnlMonth) {
  const manualRevActual = m.revenue.filter((r) => r.kind === "ACTUAL").reduce((s, r) => s + r.amountCents, 0);
  const manualRevForecast = m.revenue.filter((r) => r.kind === "FORECAST").reduce((s, r) => s + r.amountCents, 0);
  const expActual = m.expenses.filter((r) => r.kind === "ACTUAL").reduce((s, r) => s + r.amountCents, 0);
  const expForecast = m.expenses.filter((r) => r.kind === "FORECAST").reduce((s, r) => s + r.amountCents, 0);

  const bookedRevenue = m.auto.bookedCents + manualRevActual;
  const projectedRevenue = bookedRevenue + m.auto.forecastCents + manualRevForecast;
  const actualExpenses = m.auto.coachCostCents + expActual;
  const projectedExpenses = actualExpenses + expForecast;

  return {
    bookedRevenue,
    forecastRevenue: m.auto.forecastCents + manualRevForecast,
    projectedRevenue,
    actualExpenses,
    projectedExpenses,
    netBooked: bookedRevenue - actualExpenses,
    netProjected: projectedRevenue - projectedExpenses,
  };
}
