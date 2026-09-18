import "server-only";
import { prisma } from "@/lib/db";
import { installmentChargeDates } from "@/lib/payments/receipt";
import { phoenixDateInput } from "@/lib/time";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { isSessionComplete } from "@/lib/domain/coachPay";
import { stripeChargesSince, paymentsSince } from "@/lib/payments/reconcile";

// P&L, driven by a date range the admin chooses. Booked revenue is cash actually
// collected in the window — from the SAME source as the Payments "Collected"
// figure (live Stripe charges net of refunds, incl. apparel, since the
// collection start, plus offline payments) — so the two always agree. Forecast
// is money expected but not yet in: a subscription's unpaid installments at their
// scheduled dates, and outstanding one-time fees. Expenses (coach session pay is
// auto; everything else is editable) and manual revenue are line items the admin
// adds; line items are tagged to a month.

export const thisMonth = () => phoenixDateInput(new Date()).slice(0, 7);
export const today = () => phoenixDateInput(new Date());
const monthOf = (d: Date) => phoenixDateInput(d).slice(0, 7);

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map((x) => parseInt(x, 10));
  const d = new Date(Date.UTC(y, mo, 1)); // mo is 1-based → this is the next month
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type PnlEntryRow = { id: string; section: string; label: string; amountCents: number; kind: string; note: string | null; month: string };

type Contribution = { day: string; bucket: "booked" | "forecast"; cents: number };

/**
 * Every revenue contribution, tagged by Phoenix day and booked-vs-forecast.
 * BOOKED comes from the same source as the Payments "Collected" figure (live
 * Stripe net of refunds + offline payments); FORECAST is from app records
 * (unpaid installments at their scheduled dates + outstanding one-time fees).
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

  if (charges) {
    for (const c of charges) out.push({ day: day(new Date(c.created * 1000)), bucket: "booked", cents: c.netCents });
    for (const p of manual) out.push({ day: day(p.paidAt ?? p.createdAt), bucket: "booked", cents: p.amountCents });
  } else {
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

/** Booked + forecast revenue between two Phoenix days (inclusive, "YYYY-MM-DD"). */
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

/** Manual line items whose month falls within [fromMonth, toMonth] (inclusive). */
export async function entriesInMonthRange(fromMonth: string, toMonth: string): Promise<PnlEntryRow[]> {
  const rows = await prisma.pnlEntry.findMany({
    where: { month: { gte: fromMonth, lte: toMonth } },
    orderBy: [{ month: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((e) => ({ id: e.id, section: e.section, label: e.label, amountCents: e.amountCents, kind: e.kind, note: e.note, month: e.month }));
}

export type PnlRange = {
  fromDay: string;
  toDay: string;
  months: string[];
  auto: { bookedCents: number; forecastCents: number; coachCostCents: number };
  revenue: PnlEntryRow[];
  expenses: PnlEntryRow[];
  totals: {
    bookedRevenue: number; forecastRevenue: number; projectedRevenue: number;
    actualExpenses: number; projectedExpenses: number;
    netBooked: number; netProjected: number;
  };
};

/** The full P&L for a chosen date range. */
export async function pnlRange(fromDay: string, toDay: string): Promise<PnlRange> {
  const fromMonth = fromDay.slice(0, 7);
  const toMonth = toDay.slice(0, 7);
  const [rev, coach, entries] = await Promise.all([
    revenueBetween(fromDay, toDay),
    coachCostBetween(fromDay, toDay),
    entriesInMonthRange(fromMonth, toMonth),
  ]);

  const months: string[] = [];
  for (let m = fromMonth; m <= toMonth && months.length < 120; m = nextMonth(m)) months.push(m);
  if (months.length === 0) months.push(fromMonth);

  const revenue = entries.filter((e) => e.section === "REVENUE");
  const expenses = entries.filter((e) => e.section === "EXPENSE");
  const sum = (rows: PnlEntryRow[], kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.amountCents, 0);

  const bookedRevenue = rev.bookedCents + sum(revenue, "ACTUAL");
  const forecastRevenue = rev.forecastCents + sum(revenue, "FORECAST");
  const actualExpenses = coach + sum(expenses, "ACTUAL");
  const projectedExpenses = actualExpenses + sum(expenses, "FORECAST");

  return {
    fromDay, toDay, months,
    auto: { bookedCents: rev.bookedCents, forecastCents: rev.forecastCents, coachCostCents: coach },
    revenue, expenses,
    totals: {
      bookedRevenue,
      forecastRevenue,
      projectedRevenue: bookedRevenue + forecastRevenue,
      actualExpenses,
      projectedExpenses,
      netBooked: bookedRevenue - actualExpenses,
      netProjected: (bookedRevenue + forecastRevenue) - projectedExpenses,
    },
  };
}
