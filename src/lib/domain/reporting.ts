// Season P&L and retention (§16). Retention is "the metric the Academy is judged
// on." Standings are computed elsewhere; this covers the money and funnel views.

import { courtFeeForSessionCents, type FacilityRates, type DeliveredSession } from "./finance";

export type TeamPnL = {
  teamId: string;
  teamName: string;
  revenueCents: number;   // season fees collected from the team's players
  coachCostCents: number; // delivered coach sessions × rate
  courtCostCents: number; // delivered court fees at the team's facility
  contributionCents: number;
};

export function teamContribution(
  teamName: string,
  teamId: string,
  revenueCents: number,
  coachCostCents: number,
  delivered: DeliveredSession[],
  rates: FacilityRates
): TeamPnL {
  const courtCostCents =
    rates.feeBasis === "PERCENTAGE" || rates.feeBasis === "NONE"
      ? 0
      : delivered.reduce((sum, s) => sum + courtFeeForSessionCents(rates.feeBasis, s, rates), 0);
  return {
    teamId,
    teamName,
    revenueCents,
    coachCostCents,
    courtCostCents,
    contributionCents: revenueCents - coachCostCents - courtCostCents,
  };
}

export type Funnel = {
  registered: number;
  assigned: number;
  paid: number;
  attended: number;
  // Registration-to-completion proxy: attended at least one session / registered.
  completionRate: number;
};

export function completionRate(registered: number, attended: number): number {
  return registered === 0 ? 0 : attended / registered;
}
