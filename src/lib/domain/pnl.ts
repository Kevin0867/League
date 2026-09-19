import "server-only";
import { prisma } from "@/lib/db";
import { installmentChargeDates } from "@/lib/payments/receipt";
import { phoenixDateInput } from "@/lib/time";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { isSessionComplete } from "@/lib/domain/coachPay";
import { coachSessionPayCents } from "@/lib/domain/finance";
import { stripeChargesSince, paymentsSince } from "@/lib/payments/reconcile";

const SESSIONS_PER_SEASON = 12;

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

type Contribution = { day: string; bucket: "booked" | "forecast"; cents: number; personId?: string | null };

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
      select: { amountCents: true, status: true, paidAt: true, createdAt: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true, partyId: true, coveredPersonIds: true },
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

  const playerOf = (p: { coveredPersonIds: unknown; partyId: string | null }) => {
    const c = Array.isArray(p.coveredPersonIds) ? p.coveredPersonIds : [];
    return (c.length ? String(c[0]) : p.partyId) ?? null;
  };
  for (const p of pays) {
    const who = playerOf(p);
    if (p.installmentPlan) {
      const total = p.installmentsTotal ?? 3;
      const per = Math.round(p.amountCents / total);
      const dates = installmentChargeDates(p.createdAt);
      for (let i = p.installmentsPaid ?? 0; i < total; i++) out.push({ day: day(dates[i] ?? p.createdAt), bucket: "forecast", cents: per, personId: who });
    } else if (p.status !== "PAID") {
      out.push({ day: day(p.createdAt), bucket: "forecast", cents: p.amountCents, personId: who });
    }
  }
  return out;
}

/** Booked + forecast revenue between two Phoenix days (inclusive, "YYYY-MM-DD"),
 *  with a count of distinct players making up the forecast. */
export async function revenueBetween(fromDay: string, toDay: string): Promise<{ bookedCents: number; forecastCents: number; forecastPlayers: number }> {
  const contribs = await revenueContributions();
  let booked = 0, forecast = 0;
  const players = new Set<string>();
  for (const c of contribs) {
    if (c.day < fromDay || c.day > toDay) continue;
    if (c.bucket === "booked") booked += c.cents;
    else { forecast += c.cents; if (c.personId) players.add(c.personId); }
  }
  return { bookedCents: booked, forecastCents: forecast, forecastPlayers: players.size };
}

/** Day/night hour split for a session, using the facility's night-start time. */
function dayNightHours(startTime: string, endTime: string, nightStart: string): { dayHours: number; nightHours: number } {
  const toMin = (t: string) => { const [h, m] = (t || "0:0").split(":").map((x) => parseInt(x, 10)); return (h || 0) * 60 + (m || 0); };
  const s = toMin(startTime), e = toMin(endTime), n = toMin(nightStart || "17:00");
  if (e <= s) return { dayHours: 0, nightHours: 0 };
  const dayMins = Math.max(0, Math.min(e, n) - s);
  const nightMins = Math.max(0, e - Math.max(s, n));
  return { dayHours: dayMins / 60, nightHours: nightMins / 60 };
}

export type CourtCost = { facilityName: string; cents: number };

/**
 * Court rent per facility between two Phoenix days (inclusive) — the P&L expense
 * for renting courts. For each DELIVERED practice at a facility with court rates
 * set: courts × hours × rate, splitting hours into day vs night (after the
 * facility's night-start time, default 5pm) at their respective rates.
 */
export async function courtCostByFacilityBetween(fromDay: string, toDay: string): Promise<CourtCost[]> {
  const sessions = await prisma.session.findMany({
    where: { type: "PRACTICE" },
    select: {
      date: true, startTime: true, endTime: true, status: true, courtCount: true,
      facility: { select: { name: true, courtCostDayCents: true, courtCostNightCents: true, courtNightStartsAt: true } },
    },
  });
  const now = new Date();
  const byFacility = new Map<string, number>();
  for (const s of sessions) {
    if (!isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now)) continue;
    const day = phoenixDateInput(s.date);
    if (day < fromDay || day > toDay) continue;
    const f = s.facility;
    if (!f || (f.courtCostDayCents == null && f.courtCostNightCents == null)) continue;
    const dayRate = f.courtCostDayCents ?? f.courtCostNightCents ?? 0;
    const nightRate = f.courtCostNightCents ?? f.courtCostDayCents ?? 0;
    const { dayHours, nightHours } = dayNightHours(s.startTime, s.endTime, f.courtNightStartsAt ?? "17:00");
    const courts = Math.max(1, s.courtCount);
    const cost = Math.round(courts * (dayHours * dayRate + nightHours * nightRate));
    if (cost <= 0) continue;
    byFacility.set(f.name, (byFacility.get(f.name) ?? 0) + cost);
  }
  return [...byFacility.entries()].map(([facilityName, cents]) => ({ facilityName, cents })).sort((a, b) => b.cents - a.cents);
}

/** Court rent per facility for a single Phoenix month ("YYYY-MM"). */
export async function courtCostByFacilityForMonth(month: string): Promise<CourtCost[]> {
  return courtCostByFacilityBetween(`${month}-01`, `${month}-31`);
}

/**
 * "Pull in" the computed court rent as EDITABLE line items — one Court-rent
 * expense per facility, per month in the range. Upserts by (month, label) so
 * re-pulling refreshes the amounts to the latest computed figure instead of
 * duplicating. Returns how many rows were created vs updated.
 */
export async function seedCourtCostEntries(fromDay: string, toDay: string): Promise<{ created: number; updated: number }> {
  const fromMonth = fromDay.slice(0, 7);
  const toMonth = toDay.slice(0, 7);
  let created = 0, updated = 0;
  for (let m = fromMonth; m <= toMonth && created + updated < 1000; m = nextMonth(m)) {
    const costs = await courtCostByFacilityForMonth(m);
    for (const c of costs) {
      const label = `Court rent — ${c.facilityName}`;
      const existing = await prisma.pnlEntry.findFirst({ where: { month: m, section: "EXPENSE", label } });
      if (existing) {
        await prisma.pnlEntry.update({ where: { id: existing.id }, data: { amountCents: c.cents, kind: "ACTUAL" } });
        updated++;
      } else {
        await prisma.pnlEntry.create({ data: { month: m, section: "EXPENSE", label, kind: "ACTUAL", amountCents: c.cents, note: "Pulled from facility court rates — edit freely." } });
        created++;
      }
    }
  }
  return { created, updated };
}

/**
 * Coach session pay for delivered practices between two Phoenix days (inclusive)
 * — the same figure coaches are actually owed (per-coach rate = their season pay
 * ÷ 12, else the default; role-aware, assistant at 50%; a substitute earns the
 * class they covered). Matches the Payouts drill-down, scoped to the range.
 */
export async function coachCostBetween(fromDay: string, toDay: string): Promise<number> {
  const [rate, coaches, sessions] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true, assistantPct: true, proCoachPerSessionCents: true } }),
    prisma.coach.findMany({ select: { id: true, seasonPayCents: true } }),
    prisma.session.findMany({ where: { type: "PRACTICE" }, select: { date: true, endTime: true, status: true, coaches: { select: { coachId: true, role: true, payable: true } } } }),
  ]);
  const defaultPer = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const assistantPct = rate?.assistantPct ?? 0.5;
  const proPer = rate?.proCoachPerSessionCents ?? null;
  const seasonPayById = new Map(coaches.map((c) => [c.id, c.seasonPayCents]));
  const baseFor = (id: string) => { const sp = seasonPayById.get(id); return sp && sp > 0 ? Math.round(sp / SESSIONS_PER_SEASON) : defaultPer; };
  const now = new Date();
  let cost = 0;
  for (const s of sessions) {
    if (!isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now)) continue;
    const day = phoenixDateInput(s.date);
    if (day < fromDay || day > toDay) continue;
    for (const c of s.coaches) {
      if (!c.payable) continue;
      cost += coachSessionPayCents(c.role, baseFor(c.coachId), assistantPct, proPer);
    }
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
  auto: { bookedCents: number; forecastCents: number; forecastPlayers: number; coachCostCents: number; courtCosts: CourtCost[] };
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
  const [rev, coach, courtCosts, entries] = await Promise.all([
    revenueBetween(fromDay, toDay),
    coachCostBetween(fromDay, toDay),
    courtCostByFacilityBetween(fromDay, toDay),
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
  // Court rent is NOT auto-summed here — it's "pulled in" as editable line items
  // (see seedCourtCostEntries), so it's counted via sum(expenses) once pulled.
  // courtCosts stays in `auto` only as the computed preview to pull from.
  const actualExpenses = coach + sum(expenses, "ACTUAL");
  const projectedExpenses = actualExpenses + sum(expenses, "FORECAST");

  return {
    fromDay, toDay, months,
    auto: { bookedCents: rev.bookedCents, forecastCents: rev.forecastCents, forecastPlayers: rev.forecastPlayers, coachCostCents: coach, courtCosts },
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
