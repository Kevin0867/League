// Financial calculations (§9, §10). Court fees are invoiced in arrears for
// sessions actually DELIVERED — cancelled sessions are excluded automatically.
// Coaches are paid a flat per-session rate (assistant at 50%). Everything is
// integer cents.

export function durationHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? mins / 60 : 0;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export type FacilityRates = {
  feeBasis: string;
  weekdayRateCents: number;
  weekendRateCents: number;
  percentageRate: number | null;
};

export type DeliveredSession = {
  courtCount: number;
  startTime: string;
  endTime: string;
  date: Date;
};

/**
 * Court fee for a single delivered session by fee basis (§10):
 *  - PER_HOUR:    courts × hours × rate
 *  - PER_COURT:   courts × rate            (one charge per court, per session)
 *  - PER_SESSION: rate                     (flat per session)
 *  - PERCENTAGE / NONE: not per-session — handled at statement level
 * Weekday vs weekend rate resolved from the session date.
 */
export function courtFeeForSessionCents(basis: string, s: DeliveredSession, rates: FacilityRates): number {
  const rate = isWeekend(s.date) ? rates.weekendRateCents : rates.weekdayRateCents;
  switch (basis) {
    case "PER_HOUR":
      return Math.round(s.courtCount * durationHours(s.startTime, s.endTime) * rate);
    case "PER_COURT":
      return s.courtCount * rate;
    case "PER_SESSION":
      return rate;
    default:
      return 0; // PERCENTAGE and NONE are computed at the statement level
  }
}

export type StatementResult = {
  sessionsDelivered: number;
  onSiteRevenueCents: number;
  amountDueCents: number;
  basis: string;
};

/**
 * Compute a facility's monthly statement.
 *  - Usage bases sum per-session court fees over delivered sessions.
 *  - PERCENTAGE is calculated on On-Site Practice Revenue only (season fees
 *    actually collected for practices delivered at that facility, net) × rate.
 *  - NONE / in-kind produces a statement with no payment due.
 */
export function computeStatement(
  rates: FacilityRates,
  delivered: DeliveredSession[],
  onSiteRevenueCents: number
): StatementResult {
  const basis = rates.feeBasis;
  let amountDueCents = 0;

  if (basis === "PERCENTAGE") {
    amountDueCents = Math.round(onSiteRevenueCents * (rates.percentageRate ?? 0));
  } else if (basis === "NONE") {
    amountDueCents = 0;
  } else {
    amountDueCents = delivered.reduce((sum, s) => sum + courtFeeForSessionCents(basis, s, rates), 0);
  }

  return {
    sessionsDelivered: delivered.length,
    onSiteRevenueCents,
    amountDueCents,
    basis,
  };
}

// Coach payout (§9). $100 per session, assistant at 50%; Pro rate configurable.
export function coachSessionPayCents(role: string, perSessionCents: number, assistantPct: number, proPerSessionCents: number | null): number {
  if (role === "ASSISTANT") return Math.round(perSessionCents * assistantPct);
  if (role === "PRO" && proPerSessionCents) return proPerSessionCents;
  return perSessionCents; // PRIMARY, SUBSTITUTE, BACKUP paid the flat session rate
}
