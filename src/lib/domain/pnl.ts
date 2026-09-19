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

/** Day/evening hour split for a session, using the facility's evening-start time. */
function dayEveningHours(startTime: string, endTime: string, eveningStart: string): { dayHours: number; eveningHours: number } {
  const toMin = (t: string) => { const [h, m] = (t || "0:0").split(":").map((x) => parseInt(x, 10)); return (h || 0) * 60 + (m || 0); };
  const s = toMin(startTime), e = toMin(endTime), n = toMin(eveningStart || "17:00");
  if (e <= s) return { dayHours: 0, eveningHours: 0 };
  const dayMins = Math.max(0, Math.min(e, n) - s);
  const eveningMins = Math.max(0, e - Math.max(s, n));
  return { dayHours: dayMins / 60, eveningHours: eveningMins / 60 };
}

export type CourtCostLine = {
  day: string;          // "YYYY-MM-DD" (Phoenix)
  courts: number;
  dayHours: number;
  eveningHours: number;
  weekend: boolean;
  cents: number;        // this session's court cost
};
export type CourtCost = {
  facilityId: string;
  facilityName: string;
  cents: number;
  lines: CourtCostLine[];
  // The facility's configured rates (cents/court/hr), surfaced so the P&L shows
  // exactly what rates drove the numbers.
  dayRateCents: number | null;
  eveningRateCents: number | null;
  weekendRateCents: number | null;
  eveningStartsAt: string;
};

// "delivered" = practices already completed (the ACTUAL cost so far).
// "scheduled" = every non-cancelled practice in range, delivered or upcoming
// (the FORECAST cost for the whole period).
export type CourtCostBasis = "delivered" | "scheduled";

/**
 * Court rent per facility between two Phoenix days (inclusive) — the P&L expense
 * for renting courts. For each qualifying practice at a facility with court rates
 * set: courts × hours × rate, splitting hours into day vs evening (after the
 * facility's evening-start time, default 5pm) at their respective rates, with a
 * flat weekend rate. `basis` picks delivered-only vs the full scheduled period.
 */
export async function courtCostByFacilityBetween(fromDay: string, toDay: string, basis: CourtCostBasis = "delivered"): Promise<CourtCost[]> {
  const sessions = await prisma.session.findMany({
    where: { type: "PRACTICE", ...(basis === "scheduled" ? { status: { not: "CANCELLED" } } : {}) },
    select: {
      date: true, startTime: true, endTime: true, status: true, courtCount: true,
      facility: { select: { id: true, name: true, courtCostDayCents: true, courtCostEveningCents: true, courtCostWeekendCents: true, courtEveningStartsAt: true } },
    },
  });
  const now = new Date();
  // Group by facility ID (not name) so two records that share a name — e.g. a
  // duplicate with a stale rate — show separately instead of blending.
  type Agg = { facilityName: string; cents: number; lines: CourtCostLine[]; dayRateCents: number | null; eveningRateCents: number | null; weekendRateCents: number | null; eveningStartsAt: string };
  const byFacility = new Map<string, Agg>();
  for (const s of sessions) {
    // delivered → only completed sessions; scheduled → every non-cancelled one.
    if (basis === "delivered" ? !isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now) : s.status === "CANCELLED") continue;
    const day = phoenixDateInput(s.date);
    if (day < fromDay || day > toDay) continue;
    const f = s.facility;
    if (!f || (f.courtCostDayCents == null && f.courtCostEveningCents == null && f.courtCostWeekendCents == null)) continue;
    const courts = Math.max(1, s.courtCount);
    const { dayHours, eveningHours } = dayEveningHours(s.startTime, s.endTime, f.courtEveningStartsAt ?? "17:00");
    // Sessions are stored at noon UTC (Phoenix anchor), so getUTCDay() gives the
    // correct Phoenix weekday: 0 = Sun, 6 = Sat.
    const dow = s.date.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    let cost: number;
    if (isWeekend && f.courtCostWeekendCents != null) {
      // Weekend flat rate for the whole session.
      cost = Math.round(courts * (dayHours + eveningHours) * f.courtCostWeekendCents);
    } else {
      // Weekday day/evening split (also the fallback for a weekend with no weekend
      // rate set). Each tier falls back to whichever rate is set.
      const dayRate = f.courtCostDayCents ?? f.courtCostEveningCents ?? 0;
      const eveningRate = f.courtCostEveningCents ?? f.courtCostDayCents ?? 0;
      cost = Math.round(courts * (dayHours * dayRate + eveningHours * eveningRate));
    }
    if (cost <= 0) continue;
    const agg = byFacility.get(f.id) ?? {
      facilityName: f.name, cents: 0, lines: [],
      dayRateCents: f.courtCostDayCents, eveningRateCents: f.courtCostEveningCents,
      weekendRateCents: f.courtCostWeekendCents, eveningStartsAt: f.courtEveningStartsAt ?? "17:00",
    };
    agg.cents += cost;
    agg.lines.push({ day, courts, dayHours, eveningHours, weekend: isWeekend && f.courtCostWeekendCents != null, cents: cost });
    byFacility.set(f.id, agg);
  }
  return [...byFacility.entries()]
    .map(([facilityId, v]) => ({ facilityId, facilityName: v.facilityName, cents: v.cents, lines: v.lines.sort((a, b) => a.day.localeCompare(b.day)), dayRateCents: v.dayRateCents, eveningRateCents: v.eveningRateCents, weekendRateCents: v.weekendRateCents, eveningStartsAt: v.eveningStartsAt }))
    .sort((a, b) => b.cents - a.cents);
}

/** Court rent per facility for a single Phoenix month ("YYYY-MM"). */
export async function courtCostByFacilityForMonth(month: string, basis: CourtCostBasis = "delivered"): Promise<CourtCost[]> {
  return courtCostByFacilityBetween(`${month}-01`, `${month}-31`, basis);
}

/** Total court rent by facility NAME for a month + basis (summing any records
 *  that share a name), for recomputing a single "Court rent — <name>" line. */
export async function courtCostByNameForMonth(month: string, basis: CourtCostBasis): Promise<Map<string, number>> {
  const costs = await courtCostByFacilityForMonth(month, basis);
  const byName = new Map<string, number>();
  for (const c of costs) byName.set(c.facilityName, (byName.get(c.facilityName) ?? 0) + c.cents);
  return byName;
}

/**
 * "Pull in" the computed court rent as EDITABLE line items — one Court-rent
 * expense per facility, per month in the range. Upserts by (month, label) so
 * re-pulling refreshes the amounts to the latest computed figure instead of
 * duplicating. Returns how many rows were created vs updated.
 */
export async function seedCourtCostEntries(fromDay: string, toDay: string): Promise<{ created: number; updated: number; removed: number }> {
  const fromMonth = fromDay.slice(0, 7);
  const toMonth = toDay.slice(0, 7);
  let created = 0, updated = 0, removed = 0;
  for (let m = fromMonth; m <= toMonth && created + updated < 1000; m = nextMonth(m)) {
    // Delivered (ACTUAL) and full-scheduled (FORECAST) totals by facility name.
    const [deliveredByName, scheduledByName] = await Promise.all([
      courtCostByNameForMonth(m, "delivered"),
      courtCostByNameForMonth(m, "scheduled"),
    ]);
    // Every facility that has any scheduled practice this month is "wanted"
    // (scheduled ⊇ delivered), keyed by the line label.
    const wanted = new Set([...scheduledByName.keys()].map((name) => `Court rent — ${name}`));
    for (const name of scheduledByName.keys()) {
      const label = `Court rent — ${name}`;
      const existing = await prisma.pnlEntry.findFirst({ where: { month: m, section: "EXPENSE", label } });
      // A line keeps its own kind: Forecast reflects the whole scheduled month,
      // Actual reflects delivered-so-far. New lines default to Actual/delivered.
      const kind = existing?.kind === "FORECAST" ? "FORECAST" : "ACTUAL";
      const cents = (kind === "FORECAST" ? scheduledByName.get(name) : deliveredByName.get(name)) ?? 0;
      if (existing) {
        await prisma.pnlEntry.update({ where: { id: existing.id }, data: { amountCents: cents } });
        updated++;
      } else {
        await prisma.pnlEntry.create({ data: { month: m, section: "EXPENSE", label, kind: "ACTUAL", amountCents: cents, note: "Pulled from facility court rates — set to Forecast for the whole month; edit freely." } });
        created++;
      }
    }
    // Self-clean: remove any previously-pulled Court rent line for a facility
    // that no longer has scheduled practices this month. Scoped to our lines.
    const stale = await prisma.pnlEntry.findMany({ where: { month: m, section: "EXPENSE", label: { startsWith: "Court rent — " } }, select: { id: true, label: true } });
    const toDelete = stale.filter((e) => !wanted.has(e.label)).map((e) => e.id);
    if (toDelete.length) { await prisma.pnlEntry.deleteMany({ where: { id: { in: toDelete } } }); removed += toDelete.length; }
  }
  return { created, updated, removed };
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
