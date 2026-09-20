import "server-only";
import { prisma } from "@/lib/db";
import { installmentChargeDates } from "@/lib/payments/receipt";
import { phoenixDateInput } from "@/lib/time";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { isSessionComplete } from "@/lib/domain/coachPay";
import { coachSessionPayCents } from "@/lib/domain/finance";
import { stripeChargesSince, paymentsSince, activeSubscriptionSchedules, addBillingIntervals, type SubSchedule } from "@/lib/payments/reconcile";

const SESSIONS_PER_SEASON = 12;

// P&L, driven by a date range the admin chooses. Booked revenue is cash actually
// collected in the window — from the SAME source as the Payments "Collected"
// figure (live Stripe charges net of refunds, incl. apparel, since the
// collection start, plus offline payments) — so the two always agree. Forecast
// is money expected but not yet in: a subscription's unpaid installments at their
// scheduled dates, and outstanding one-time fees. Expenses (coach session pay is
// auto; everything else is editable) and manual revenue are line items the admin
// adds; line items are tagged to a month.

/** Person ids on a team in the active season — "assigned" players. Expected /
 *  forecast revenue is only counted for these, since many families register but
 *  are never placed (schedules don't line up) and won't actually pay/play. */
export async function assignedPlayerIds(): Promise<Set<string>> {
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));
  if (!season) return new Set();
  // Exclude test teams — their players aren't real, so they never count.
  const members = await prisma.teamMember.findMany({ where: { team: { seasonId: season.id, isTest: false } }, select: { personId: true } });
  return new Set(members.map((m) => m.personId));
}

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

type Contribution = { day: string; bucket: "booked" | "forecast"; cents: number; personId?: string | null; kind?: "installment" | "unpaidFee" };

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

  const [charges, pays, manual, assigned, subSchedules] = await Promise.all([
    stripeChargesSince(sinceUnix).catch(() => null),
    prisma.payment.findMany({
      where: { direction: "IN", status: { in: ["PAID", "PENDING", "REQUESTED"] }, category: { not: "REFUND" } },
      select: { amountCents: true, status: true, paidAt: true, createdAt: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true, partyId: true, coveredPersonIds: true, stripeSubscriptionId: true },
    }),
    prisma.payment.findMany({ where: { direction: "IN", status: "PAID", method: "MANUAL", category: { not: "REFUND" } }, select: { amountCents: true, paidAt: true, createdAt: true } }),
    assignedPlayerIds(),
    // Real remaining charge dates per Stripe subscription (one paginated call,
    // cached) — used to project each plan's installments onto the months they'll
    // actually bill instead of the createdAt +30/+60 estimate.
    activeSubscriptionSchedules().catch(() => new Map<string, SubSchedule>()),
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
  // Forecast (expected) revenue is only counted for players actually placed on a
  // team — a registrant we never seated won't pay/play, so don't project them.
  const coversAssigned = (p: { coveredPersonIds: unknown; partyId: string | null }) => {
    const ids = Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as unknown[]).map(String) : [];
    return ids.some((id) => assigned.has(id)) || (!!p.partyId && assigned.has(p.partyId));
  };
  const todayStr = day(new Date());
  for (const p of pays) {
    if (!coversAssigned(p)) continue;
    const who = playerOf(p);
    if (p.installmentPlan) {
      const total = p.installmentsTotal ?? 3;
      const per = Math.round(p.amountCents / total);
      const paid = p.installmentsPaid ?? 0;
      const remaining = Math.max(0, total - paid);
      // Prefer the REAL schedule from Stripe (this plan's next charge date + its
      // billing interval), so each remaining installment lands in the month it
      // will actually bill. Fall back to the createdAt +30/+60 estimate when the
      // subscription isn't linked or Stripe is unavailable.
      const sched = p.stripeSubscriptionId ? subSchedules.get(p.stripeSubscriptionId) : undefined;
      const dueDates: Date[] = [];
      if (sched) {
        for (let k = 0; k < remaining; k++) dueDates.push(addBillingIntervals(sched.next, k, sched.interval, sched.intervalCount));
      } else {
        const est = installmentChargeDates(p.createdAt);
        for (let i = paid; i < total; i++) dueDates.push(est[i] ?? p.createdAt);
      }
      for (const dd of dueDates) {
        const d = day(dd);
        // Only FUTURE installments are forecast. A due/past installment is either
        // already collected (counted in booked from Stripe) or genuinely late —
        // counting it here too would let the subscription forecast exceed the real
        // remaining (e.g. > 2 payments left on a 3-pay plan). This also keeps the
        // forecast correct even if installmentsPaid lags the webhook.
        if (d < todayStr) continue;
        out.push({ day: d, bucket: "forecast", cents: per, personId: who, kind: "installment" });
      }
    } else if (p.status !== "PAID") {
      out.push({ day: day(p.createdAt), bucket: "forecast", cents: p.amountCents, personId: who, kind: "unpaidFee" });
    }
  }
  return out;
}

export type ForecastLine = { personId: string | null; name: string; cents: number; installmentCents: number; unpaidFeeCents: number };
export type RevenueDetail = {
  bookedCents: number; forecastCents: number; forecastPlayers: number;
  installmentCents: number; unpaidFeeCents: number; forecastLines: ForecastLine[];
};

/** Booked + forecast revenue between two Phoenix days (inclusive), with a
 *  breakdown of what makes up the forecast — installments still due vs unpaid
 *  one-time fees, grouped by player — so the projection can be audited. */
export async function revenueBetween(fromDay: string, toDay: string): Promise<RevenueDetail> {
  const contribs = await revenueContributions();
  let booked = 0, forecast = 0, installmentCents = 0, unpaidFeeCents = 0;
  const players = new Set<string>();
  const byPerson = new Map<string, { installment: number; unpaid: number }>();
  for (const c of contribs) {
    if (c.day < fromDay || c.day > toDay) continue;
    if (c.bucket === "booked") { booked += c.cents; continue; }
    forecast += c.cents;
    if (c.personId) players.add(c.personId);
    const key = c.personId ?? "unknown";
    const agg = byPerson.get(key) ?? { installment: 0, unpaid: 0 };
    if (c.kind === "installment") { agg.installment += c.cents; installmentCents += c.cents; }
    else { agg.unpaid += c.cents; unpaidFeeCents += c.cents; }
    byPerson.set(key, agg);
  }
  const ids = [...byPerson.keys()].filter((k) => k !== "unknown");
  const people = ids.length ? await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const nameById = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
  const forecastLines: ForecastLine[] = [...byPerson.entries()]
    .map(([id, v]) => ({ personId: id === "unknown" ? null : id, name: id === "unknown" ? "Unknown" : (nameById.get(id) ?? "Unknown"), cents: v.installment + v.unpaid, installmentCents: v.installment, unpaidFeeCents: v.unpaid }))
    .sort((a, b) => b.cents - a.cents);
  return { bookedCents: booked, forecastCents: forecast, forecastPlayers: players.size, installmentCents, unpaidFeeCents, forecastLines };
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
type FacilityRates = { courtCostDayCents: number | null; courtCostEveningCents: number | null; courtCostWeekendCents: number | null; courtEveningStartsAt: string | null };
/** Court cost for one practice session at a facility, applying the day/evening
 *  split and weekend flat rate. 0 if the facility has no rates set. */
function courtCostOfSession(s: { date: Date; startTime: string; endTime: string; courtCount: number }, f: FacilityRates): number {
  if (f.courtCostDayCents == null && f.courtCostEveningCents == null && f.courtCostWeekendCents == null) return 0;
  const courts = Math.max(1, s.courtCount);
  const { dayHours, eveningHours } = dayEveningHours(s.startTime, s.endTime, f.courtEveningStartsAt ?? "17:00");
  const dow = s.date.getUTCDay();
  if ((dow === 0 || dow === 6) && f.courtCostWeekendCents != null) return Math.round(courts * (dayHours + eveningHours) * f.courtCostWeekendCents);
  const dayRate = f.courtCostDayCents ?? f.courtCostEveningCents ?? 0;
  const eveningRate = f.courtCostEveningCents ?? f.courtCostDayCents ?? 0;
  return Math.round(courts * (dayHours * dayRate + eveningHours * eveningRate));
}

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
    // Exclude test teams — their sessions/coaches/players are not real.
    where: { type: "PRACTICE", teams: { some: { team: { isTest: false } } }, ...(basis === "scheduled" ? { status: { not: "CANCELLED" } } : {}) },
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
    prisma.session.findMany({ where: { type: "PRACTICE", teams: { some: { team: { isTest: false } } } }, select: { date: true, endTime: true, status: true, coaches: { select: { coachId: true, role: true, payable: true } } } }),
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

export type CoachCostLine = { day: string; startTime: string; teamName: string | null; role: string; cents: number };
export type CoachCost = { coachId: string; name: string; cents: number; lines: CoachCostLine[] };

/** Coach session pay for delivered practices in range, broken out PER COACH with
 *  the individual sessions (day, time, team, role, pay) behind each total. */
export async function coachCostByCoachBetween(fromDay: string, toDay: string, basis: CourtCostBasis = "delivered"): Promise<CoachCost[]> {
  const [rate, coaches, sessions] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true, assistantPct: true, proCoachPerSessionCents: true } }),
    prisma.coach.findMany({ select: { id: true, seasonPayCents: true, person: { select: { firstName: true, lastName: true } } } }),
    prisma.session.findMany({ where: { type: "PRACTICE", teams: { some: { team: { isTest: false } } } }, select: { date: true, startTime: true, endTime: true, status: true, teams: { select: { team: { select: { name: true } } } }, coaches: { select: { coachId: true, role: true, payable: true } } } }),
  ]);
  const defaultPer = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const assistantPct = rate?.assistantPct ?? 0.5;
  const proPer = rate?.proCoachPerSessionCents ?? null;
  const seasonPayById = new Map(coaches.map((c) => [c.id, c.seasonPayCents]));
  const nameById = new Map(coaches.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`.trim()]));
  const baseFor = (id: string) => { const sp = seasonPayById.get(id); return sp && sp > 0 ? Math.round(sp / SESSIONS_PER_SEASON) : defaultPer; };
  const now = new Date();
  const byCoach = new Map<string, CoachCost>();
  for (const s of sessions) {
    // delivered → completed sessions only; scheduled → every non-cancelled one.
    if (basis === "delivered" ? !isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now) : s.status === "CANCELLED") continue;
    const day = phoenixDateInput(s.date);
    if (day < fromDay || day > toDay) continue;
    const teamName = s.teams[0]?.team.name ?? null;
    for (const c of s.coaches) {
      if (!c.payable) continue;
      const cents = coachSessionPayCents(c.role, baseFor(c.coachId), assistantPct, proPer);
      const cc = byCoach.get(c.coachId) ?? { coachId: c.coachId, name: nameById.get(c.coachId) ?? "Coach", cents: 0, lines: [] };
      cc.cents += cents;
      cc.lines.push({ day, startTime: s.startTime, teamName, role: c.role, cents });
      byCoach.set(c.coachId, cc);
    }
  }
  return [...byCoach.values()]
    .map((c) => ({ ...c, lines: c.lines.sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime)) }))
    .sort((a, b) => b.cents - a.cents);
}

// ---------------------------------------------------------------------------
// League & championship nights (court + coach cost for the forecast)
// ---------------------------------------------------------------------------
// League matches and championships are Fixtures (not practice Sessions), so they
// carry no per-session court count, duration, or coach assignments — which is
// why the practice-only court/coach queries above stop after the practice weeks
// (late Oct) and league/championship costs never appeared in the P&L.
//
// We project each night from the real fixtures on the schedule, using the
// league-night shape the academy runs to:
//   • All matches run CONCURRENTLY at one host facility (e.g. Mesa), so a night
//     is one facility+date, and the courts needed are the SUM of the courts each
//     match uses at once (by match format).
//   • Every night is ~2 hours in the evening (facility evening rate; weekend flat
//     rate on Sat/Sun).
//   • ALL coaches attend EVERY league match, so coach cost per night =
//     (number of coaches) × the per-session pay rate.
const LEAGUE_NIGHT_HOURS = 2;
/** Courts one match occupies at once, by format (lines played simultaneously). */
function courtsPerMatch(matchType: string | null): number {
  switch (matchType) {
    case "SINGLE_LINE": return 1;
    case "TEAM_5": return 5;
    case "TEAM_3":
    default: return 4; // 3 counting lines + exhibition
  }
}

export type LeagueNight = {
  facilityId: string;
  facilityName: string;
  day: string;            // Phoenix "YYYY-MM-DD"
  courts: number;         // total concurrent courts across the night's matches
  weekend: boolean;
  courtCents: number;     // 0 when the facility has no rates set
  coachCents: number;     // all coaches × per-session pay
  coachCount: number;
  matchCount: number;
  delivered: boolean;     // the night is in the past (for the booked basis)
};

/** The distinct coaches on the academy's real (non-test) teams this season —
 *  "all our coaches", who attend every league night. */
async function activeCoachIds(): Promise<Set<string>> {
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));
  if (!season) return new Set();
  const teams = await prisma.team.findMany({
    where: { seasonId: season.id, isTest: false },
    select: { coachId: true, assistantCoaches: { select: { coachId: true } } },
  });
  const ids = new Set<string>();
  for (const t of teams) {
    if (t.coachId) ids.add(t.coachId);
    for (const a of t.assistantCoaches) ids.add(a.coachId);
  }
  return ids;
}

/**
 * Every league/championship night derived from the fixtures on the schedule,
 * with its projected court + coach cost. One entry per host facility + date
 * (all that night's matches run at once). Test-only fixtures are excluded.
 */
export async function leagueNightsProjection(): Promise<LeagueNight[]> {
  const [rate, coachIds, fixtures] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true } }),
    activeCoachIds(),
    prisma.fixture.findMany({
      select: {
        scheduledAt: true, matchType: true,
        homeTeam: { select: { isTest: true } },
        awayTeam: { select: { isTest: true } },
        facility: { select: { id: true, name: true, courtCostDayCents: true, courtCostEveningCents: true, courtCostWeekendCents: true } },
      },
    }),
  ]);
  const perCoachCents = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const coachCount = coachIds.size;
  const now = new Date();

  // Group concurrent matches into a night: same host facility + Phoenix date.
  type Night = { facilityId: string; facilityName: string; rates: FacilityRates; day: string; courts: number; matchCount: number; scheduledAt: Date };
  const byNight = new Map<string, Night>();
  for (const f of fixtures) {
    if (!f.facility) continue; // no host facility → can't price courts
    // Skip a fixture only when BOTH sides are test teams (a rehearsal match).
    if ((f.homeTeam?.isTest ?? false) && (f.awayTeam?.isTest ?? false)) continue;
    const day = phoenixDateInput(f.scheduledAt);
    const key = `${f.facility.id}::${day}`;
    const cur = byNight.get(key) ?? {
      facilityId: f.facility.id, facilityName: f.facility.name,
      rates: { courtCostDayCents: f.facility.courtCostDayCents, courtCostEveningCents: f.facility.courtCostEveningCents, courtCostWeekendCents: f.facility.courtCostWeekendCents, courtEveningStartsAt: null },
      day, courts: 0, matchCount: 0, scheduledAt: f.scheduledAt,
    };
    cur.courts += courtsPerMatch(f.matchType); // concurrent → courts add up
    cur.matchCount += 1;
    byNight.set(key, cur);
  }

  const out: LeagueNight[] = [];
  for (const n of byNight.values()) {
    const f = n.rates;
    const hasRates = f.courtCostDayCents != null || f.courtCostEveningCents != null || f.courtCostWeekendCents != null;
    const dow = new Date(`${n.day}T12:00:00Z`).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    let courtCents = 0;
    if (hasRates) {
      if (isWeekend && f.courtCostWeekendCents != null) {
        courtCents = Math.round(n.courts * LEAGUE_NIGHT_HOURS * f.courtCostWeekendCents);
      } else {
        // League nights are in the evening → evening rate (fall back to day rate).
        const eve = f.courtCostEveningCents ?? f.courtCostDayCents ?? 0;
        courtCents = Math.round(n.courts * LEAGUE_NIGHT_HOURS * eve);
      }
    }
    out.push({
      facilityId: n.facilityId, facilityName: n.facilityName, day: n.day,
      courts: n.courts, weekend: isWeekend && f.courtCostWeekendCents != null,
      courtCents, coachCents: coachCount * perCoachCents, coachCount, matchCount: n.matchCount,
      delivered: n.scheduledAt.getTime() <= now.getTime(),
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Manual line items whose month falls within [fromMonth, toMonth] (inclusive). */
export async function entriesInMonthRange(fromMonth: string, toMonth: string): Promise<PnlEntryRow[]> {
  const rows = await prisma.pnlEntry.findMany({
    where: { month: { gte: fromMonth, lte: toMonth } },
    orderBy: [{ month: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((e) => ({ id: e.id, section: e.section, label: e.label, amountCents: e.amountCents, kind: e.kind, note: e.note, month: e.month }));
}

// The P&L view basis: booked = actuals (collected + delivered), forecast = the
// full projection for the range (maps to delivered/scheduled for coach & court).
export type PnlBasis = "booked" | "forecast";

export type PnlRange = {
  fromDay: string;
  toDay: string;
  months: string[];
  basis: PnlBasis;
  auto: {
    bookedCents: number; forecastPlayers: number; installmentCents: number; unpaidFeeCents: number; forecastLines: ForecastLine[];
    coachCostCents: number; coaches: CoachCost[];
    courtCostCents: number; courtCosts: CourtCost[];
  };
  revenue: PnlEntryRow[];   // manual revenue line items
  expenses: PnlEntryRow[];  // manual expense line items (court is auto, excluded here)
  totals: {
    // On the chosen basis: Revenue − Expenses = Net income; the Director earns
    // directorPct of net income; Net to PURE is the remainder.
    revenue: number; expenses: number; netIncome: number;
    directorPayCents: number; netToPureCents: number; directorPct: number;
  };
};

/** Default Director share of monthly net income when none is configured. */
export const DIRECTOR_PCT = 0.15;
const DIRECTOR_PCT_KEY = "directorPayPct";

/** The configured Director share of net income (0–1). Editable; falls back to
 *  DIRECTOR_PCT. Stored as a percent string (e.g. "15" or "12.5") in SiteContent. */
export async function getDirectorPct(): Promise<number> {
  const row = await prisma.siteContent.findUnique({ where: { key: DIRECTOR_PCT_KEY } }).catch(() => null);
  const pct = row ? parseFloat(row.value) : NaN;
  if (!Number.isFinite(pct) || pct < 0) return DIRECTOR_PCT;
  return Math.min(pct, 100) / 100;
}

/**
 * The full P&L for a date range on a chosen basis. Coach pay AND court fees are
 * auto and basis-aware: BOOKED = delivered practices only; FORECAST = every
 * scheduled practice in the range (from the schedule & facility rates). So a
 * forecast over Aug 26–Sep 30 pulls in all coach + court through Sep 30.
 */
export async function pnlRange(fromDay: string, toDay: string, basis: PnlBasis = "forecast"): Promise<PnlRange> {
  const fromMonth = fromDay.slice(0, 7);
  const toMonth = toDay.slice(0, 7);
  const cb: CourtCostBasis = basis === "booked" ? "delivered" : "scheduled";
  const [rev, coaches, courtCosts, entries, directorPct, leagueNights] = await Promise.all([
    revenueBetween(fromDay, toDay),
    coachCostByCoachBetween(fromDay, toDay, cb),
    courtCostByFacilityBetween(fromDay, toDay, cb),
    entriesInMonthRange(fromMonth, toMonth),
    getDirectorPct(),
    leagueNightsProjection(),
  ]);

  // Fold in league & championship nights (fixtures, not practices) for the range,
  // basis-aware: booked = nights already played; forecast = every night on the
  // schedule. Court cost merges into its host facility's line; coach cost (all
  // coaches attend every night) is one "League & championship coaches" line.
  const nightsInRange = leagueNights.filter((n) => n.day >= fromDay && n.day <= toDay && (cb === "delivered" ? n.delivered : true));
  let leagueCoachCents = 0;
  const leagueCoachLines: CoachCostLine[] = [];
  for (const n of nightsInRange) {
    if (n.courtCents > 0) {
      const existing = courtCosts.find((c) => c.facilityId === n.facilityId);
      const line: CourtCostLine = { day: n.day, courts: n.courts, dayHours: 0, eveningHours: LEAGUE_NIGHT_HOURS, weekend: n.weekend, cents: n.courtCents };
      if (existing) { existing.cents += n.courtCents; existing.lines.push(line); existing.lines.sort((a, b) => a.day.localeCompare(b.day)); }
      else courtCosts.push({ facilityId: n.facilityId, facilityName: n.facilityName, cents: n.courtCents, lines: [line], dayRateCents: null, eveningRateCents: null, weekendRateCents: null, eveningStartsAt: "17:00" });
    }
    if (n.coachCents > 0) {
      leagueCoachCents += n.coachCents;
      leagueCoachLines.push({ day: n.day, startTime: "—", teamName: `League night (${n.coachCount} coaches × ${n.matchCount} match${n.matchCount === 1 ? "" : "es"})`, role: "LEAGUE", cents: n.coachCents });
    }
  }
  if (leagueCoachCents > 0) {
    coaches.push({ coachId: "__league__", name: "League & championship coaches", cents: leagueCoachCents, lines: leagueCoachLines.sort((a, b) => a.day.localeCompare(b.day)) });
    coaches.sort((a, b) => b.cents - a.cents);
  }

  const coach = coaches.reduce((s, c) => s + c.cents, 0);
  const court = courtCosts.reduce((s, c) => s + c.cents, 0);
  const months: string[] = [];
  for (let m = fromMonth; m <= toMonth && months.length < 120; m = nextMonth(m)) months.push(m);
  if (months.length === 0) months.push(fromMonth);

  const revenue = entries.filter((e) => e.section === "REVENUE");
  // Court is auto — exclude any legacy pulled "Court rent —" lines to avoid
  // double-counting; all other expense lines stay editable.
  const expenses = entries.filter((e) => e.section === "EXPENSE" && !e.label.startsWith("Court rent — "));
  const sumForBasis = (rows: PnlEntryRow[]) => (basis === "booked" ? rows.filter((r) => r.kind === "ACTUAL") : rows).reduce((s, r) => s + r.amountCents, 0);

  const autoRevenue = basis === "booked" ? rev.bookedCents : rev.bookedCents + rev.forecastCents;
  const revenueTotal = autoRevenue + sumForBasis(revenue);
  const expenseTotal = coach + court + sumForBasis(expenses);
  const netIncome = revenueTotal - expenseTotal;
  const directorPayCents = Math.max(0, Math.round(netIncome * directorPct));
  const netToPureCents = netIncome - directorPayCents;

  return {
    fromDay, toDay, months, basis,
    auto: {
      bookedCents: rev.bookedCents, forecastPlayers: rev.forecastPlayers,
      installmentCents: rev.installmentCents, unpaidFeeCents: rev.unpaidFeeCents, forecastLines: rev.forecastLines,
      coachCostCents: coach, coaches, courtCostCents: court, courtCosts,
    },
    revenue, expenses,
    totals: { revenue: revenueTotal, expenses: expenseTotal, netIncome, directorPayCents, netToPureCents, directorPct },
  };
}

export type MonthPnl = {
  month: string;
  bookedRevenueCents: number; actualExpenseCents: number; bookedNetCents: number; bookedDirectorCents: number; bookedNetToPureCents: number;
  forecastRevenueCents: number; forecastExpenseCents: number; forecastNetCents: number; forecastDirectorCents: number; forecastNetToPureCents: number;
  // Forecast revenue split, so "why is it growing" is visible per month.
  installmentCents: number; unpaidFeeCents: number;
};

/**
 * The 5 statement figures per month across a season, on BOTH bases — a real
 * forecast. Booked = collected revenue + delivered coach pay + delivered court +
 * actual expense lines. Forecast = collected + scheduled revenue + coach pay AND
 * court fees for EVERY scheduled practice that month (from the season schedule &
 * facility rates) + all non-court expense lines. Court is auto-projected from the
 * schedule here (not the pulled ledger lines), so future months aren't $0.
 */
export async function pnlSeasonByMonth(months: string[]): Promise<MonthPnl[]> {
  if (months.length === 0) return [];
  const now = new Date();
  const [contribs, directorPct, allEntries, rate, coachRows, sessions, leagueNights] = await Promise.all([
    revenueContributions(),
    getDirectorPct(),
    entriesInMonthRange(months[0], months[months.length - 1]),
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true, assistantPct: true, proCoachPerSessionCents: true } }),
    prisma.coach.findMany({ select: { id: true, seasonPayCents: true } }),
    prisma.session.findMany({
      where: { type: "PRACTICE", teams: { some: { team: { isTest: false } } } },
      select: {
        date: true, startTime: true, endTime: true, status: true, courtCount: true,
        coaches: { select: { coachId: true, role: true, payable: true } },
        facility: { select: { courtCostDayCents: true, courtCostEveningCents: true, courtCostWeekendCents: true, courtEveningStartsAt: true } },
      },
    }),
    leagueNightsProjection(),
  ]);
  const defaultPer = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const assistantPct = rate?.assistantPct ?? 0.5;
  const proPer = rate?.proCoachPerSessionCents ?? null;
  const seasonPayById = new Map(coachRows.map((c) => [c.id, c.seasonPayCents]));
  const baseFor = (id: string) => { const sp = seasonPayById.get(id); return sp && sp > 0 ? Math.round(sp / SESSIONS_PER_SEASON) : defaultPer; };

  // Coach pay + court cost each session contributes, tagged by month + basis.
  const sessionCost = (s: (typeof sessions)[number]) => {
    const coach = s.coaches.reduce((sum, c) => (c.payable ? sum + coachSessionPayCents(c.role, baseFor(c.coachId), assistantPct, proPer) : sum), 0);
    const court = s.facility ? courtCostOfSession(s, s.facility) : 0;
    return { coach, court };
  };

  const sumKind = (rows: PnlEntryRow[], kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.amountCents, 0);
  const sumAll = (rows: PnlEntryRow[]) => rows.reduce((s, r) => s + r.amountCents, 0);
  const out: MonthPnl[] = [];
  for (const m of months) {
    const mStart = `${m}-01`, mEnd = `${m}-31`;
    let booked = 0, forecastRev = 0, installment = 0, unpaid = 0;
    for (const c of contribs) {
      if (c.day < mStart || c.day > mEnd) continue;
      if (c.bucket === "booked") booked += c.cents;
      else if (c.kind === "installment") installment += c.cents;
      else unpaid += c.cents;
      forecastRev += c.cents;
    }
    // Coach + court for this month, split delivered (booked) vs scheduled (forecast).
    let coachDelivered = 0, coachScheduled = 0, courtDelivered = 0, courtScheduled = 0;
    for (const s of sessions) {
      const day = phoenixDateInput(s.date);
      if (day < mStart || day > mEnd) continue;
      if (s.status === "CANCELLED") continue;
      const { coach, court } = sessionCost(s);
      coachScheduled += coach; courtScheduled += court;
      if (isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now)) { coachDelivered += coach; courtDelivered += court; }
    }
    // League & championship nights (fixtures) in this month — same court + coach
    // model as pnlRange, split delivered (played) vs scheduled (all on the books).
    for (const n of leagueNights) {
      if (n.day < mStart || n.day > mEnd) continue;
      coachScheduled += n.coachCents; courtScheduled += n.courtCents;
      if (n.delivered) { coachDelivered += n.coachCents; courtDelivered += n.courtCents; }
    }
    const revLines = allEntries.filter((e) => e.month === m && e.section === "REVENUE");
    // Court rent is auto-projected above, so drop pulled "Court rent —" lines to
    // avoid double-counting; keep all other expense lines (rent, supplies, etc.).
    const expLines = allEntries.filter((e) => e.month === m && e.section === "EXPENSE" && !e.label.startsWith("Court rent — "));

    const bookedRevenue = booked + sumKind(revLines, "ACTUAL");
    const forecastRevenue = forecastRev + sumAll(revLines);
    const actualExpense = coachDelivered + courtDelivered + sumKind(expLines, "ACTUAL");
    const forecastExpense = coachScheduled + courtScheduled + sumAll(expLines);
    const bookedNet = bookedRevenue - actualExpense;
    const forecastNet = forecastRevenue - forecastExpense;
    const bookedDirector = Math.max(0, Math.round(bookedNet * directorPct));
    const forecastDirector = Math.max(0, Math.round(forecastNet * directorPct));
    out.push({
      month: m,
      bookedRevenueCents: bookedRevenue, actualExpenseCents: actualExpense, bookedNetCents: bookedNet, bookedDirectorCents: bookedDirector, bookedNetToPureCents: bookedNet - bookedDirector,
      forecastRevenueCents: forecastRevenue, forecastExpenseCents: forecastExpense, forecastNetCents: forecastNet, forecastDirectorCents: forecastDirector, forecastNetToPureCents: forecastNet - forecastDirector,
      installmentCents: installment, unpaidFeeCents: unpaid,
    });
  }
  return out;
}
