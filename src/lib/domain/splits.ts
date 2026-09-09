// À la carte revenue split (§0, §11). Court cost comes off the top, THEN the
// split is applied to net. The rate set is resolved from who teaches, and the
// applied rates are stamped onto the transaction so a historical payout can be
// reconstructed after a rate change.
//
//   Assigned Coach teaches:  Coach 60% / Director 10% / PURE 30%
//   Director teaches:        Coach 60% / Director 10% / PURE 30%
//     (same split either way; when the Director teaches they take the 60% coach
//      line + 10% director line = 70%, PURE retains 30%)

export type SplitRates = {
  coachPct: number;
  directorPct: number;
  purePct: number;
};

export const COACH_TEACHES: SplitRates = {
  coachPct: 0.6,
  directorPct: 0.1,
  purePct: 0.3,
};

export const DIRECTOR_TEACHES: SplitRates = {
  coachPct: 0.6,
  directorPct: 0.1,
  purePct: 0.3,
};

export function resolveRates(directorTaught: boolean): SplitRates {
  return directorTaught ? DIRECTOR_TEACHES : COACH_TEACHES;
}

export type SplitResult = {
  grossCents: number;
  courtCostCents: number;
  netCents: number;
  coachCents: number;
  directorCents: number;
  pureCents: number;
  rates: SplitRates;
};

/**
 * Compute the à la carte split. Court cost off the top, then split net.
 * Remainder cents are assigned to PURE so the three lines always reconcile to
 * net exactly (no lost/created pennies).
 */
export function computeSplit(
  grossCents: number,
  courtCostCents: number,
  directorTaught: boolean
): SplitResult {
  const rates = resolveRates(directorTaught);
  const netCents = Math.max(0, grossCents - courtCostCents);
  const coachCents = Math.round(netCents * rates.coachPct);
  const directorCents = Math.round(netCents * rates.directorPct);
  const pureCents = netCents - coachCents - directorCents; // absorbs rounding
  return {
    grossCents,
    courtCostCents,
    netCents,
    coachCents,
    directorCents,
    pureCents,
    rates,
  };
}
