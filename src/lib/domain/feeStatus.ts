// One source of truth for how a player's season-fee status is displayed across
// the app (registrations list + detail, team roster, portal). Three "settled or
// in-progress" states plus refunded:
//
//   paid          — paid in full (one-time payment cleared, or all 3 plan
//                   installments cleared). Green ✓.
//   subscription  — on the 3-payment plan, signed up and at least the first
//                   payment cleared, but not finished. Green ✓.
//   unpaid        — a fee is owed (requested, or a checkout started but no money
//                   in yet). Amber.
//   refunded      — a paid fee was refunded.
//   none          — no fee invoiced yet.

export type FeeState = "none" | "unpaid" | "subscription" | "paid" | "refunded";

export type FeePaymentBits = {
  status: string; // REQUESTED | PENDING | PAID | FAILED | REFUNDED | WAIVED | CREDITED
  installmentPlan?: boolean | null;
  installmentsPaid?: number | null;
  installmentsTotal?: number | null;
};

/** Significance order, for reducing a person's several payments to one state. */
export function feeStateRank(s: FeeState): number {
  return s === "paid" ? 4 : s === "subscription" ? 3 : s === "refunded" ? 2 : s === "unpaid" ? 1 : 0;
}

/** The display state for ONE payment. A 3-payment plan that has begun (first
 *  installment cleared) but isn't finished reads as "subscription"; once every
 *  installment clears the webhook flips it to PAID → "paid". */
export function feeStateOf(p: FeePaymentBits): FeeState {
  if (p.status === "PAID") return "paid";
  if (p.status === "REFUNDED") return "refunded";
  if (p.installmentPlan && p.status === "PENDING" && (p.installmentsPaid ?? 0) >= 1) return "subscription";
  if (p.status === "REQUESTED" || p.status === "PENDING") return "unpaid";
  return "none";
}

/** Reduce a person's PLAYER_FEE payments to their single most significant state. */
export function reduceFeeState(payments: FeePaymentBits[]): FeeState {
  let best: FeeState = "none";
  for (const p of payments) {
    const s = feeStateOf(p);
    if (feeStateRank(s) > feeStateRank(best)) best = s;
  }
  return best;
}

/** Short label + tone for a state, so every surface renders it identically. */
export function feeStateDisplay(s: FeeState): { label: string; check: boolean; tone: "emerald" | "amber" | "slate" } {
  switch (s) {
    case "paid": return { label: "paid", check: true, tone: "emerald" };
    case "subscription": return { label: "subscription", check: true, tone: "emerald" };
    case "unpaid": return { label: "fee due", check: false, tone: "amber" };
    case "refunded": return { label: "refunded", check: false, tone: "slate" };
    default: return { label: "no fee yet", check: false, tone: "slate" };
  }
}
