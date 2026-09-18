import "server-only";
import { prisma } from "@/lib/db";
import { installmentChargeDates } from "@/lib/payments/receipt";
import { phoenixDateInput } from "@/lib/time";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { isSessionComplete } from "@/lib/domain/coachPay";

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

/**
 * Revenue by Phoenix month, split into booked (collected) vs forecast (expected
 * but not yet collected). One-time fees book in the month they were paid;
 * installment plans book each paid installment in its own scheduled month and
 * project the unpaid ones forward.
 */
export async function revenueByMonth(): Promise<Map<string, { bookedCents: number; forecastCents: number }>> {
  const pays = await prisma.payment.findMany({
    where: { direction: "IN", status: { in: ["PAID", "PENDING", "REQUESTED"] }, category: { not: "REFUND" } },
    select: { amountCents: true, status: true, paidAt: true, createdAt: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true },
  });
  const m = new Map<string, { bookedCents: number; forecastCents: number }>();
  const add = (month: string, key: "bookedCents" | "forecastCents", cents: number) => {
    const cur = m.get(month) ?? { bookedCents: 0, forecastCents: 0 };
    cur[key] += cents;
    m.set(month, cur);
  };
  for (const p of pays) {
    if (p.installmentPlan) {
      const total = p.installmentsTotal ?? 3;
      const per = Math.round(p.amountCents / total);
      const dates = installmentChargeDates(p.createdAt);
      const paid = p.installmentsPaid ?? 0;
      for (let i = 0; i < total; i++) {
        const month = monthOf(dates[i] ?? p.createdAt);
        add(month, i < paid ? "bookedCents" : "forecastCents", per);
      }
    } else if (p.status === "PAID") {
      add(monthOf(p.paidAt ?? p.createdAt), "bookedCents", p.amountCents);
    } else {
      // Outstanding one-time fee — expected, not collected: forecast it in the
      // month it was requested.
      add(monthOf(p.createdAt), "forecastCents", p.amountCents);
    }
  }
  return m;
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
