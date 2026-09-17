import "server-only";
import { prisma } from "@/lib/db";
import { stripeCollectedBreakdown, paymentsSince } from "@/lib/payments/reconcile";

// The single source of truth for the headline money figures, so every page that
// shows "collected / outstanding / refunded" agrees to the dollar. Mirrors the
// Payments page exactly:
//   • Collected — the real sum of succeeded Stripe charges (net of refunds) since
//     the season's collection start, plus offline (manual) payments. Falls back
//     to recorded PAID rows + apparel when Stripe isn't connected.
//   • Outstanding — requested/pending fees, less the already-cleared portion of
//     active installment plans (so a plan mid-way isn't counted as fully unpaid).
//   • Refunded — money actually returned: the sum of booked refund rows
//     (OUT / REFUND), which captures partial refunds correctly.
// NOT season-scoped — it's the whole ledger, matching the Payments page.

export type FinanceSummary = {
  collectedCents: number;
  requestedCents: number;
  refundedCents: number;
  usingStripe: boolean;
};

export async function financeSummary(): Promise<FinanceSummary> {
  const [collectedAgg, outstanding, manualAgg, apparelItems, refundAgg] = await Promise.all([
    prisma.payment.aggregate({ where: { direction: "IN", status: "PAID" }, _sum: { amountCents: true } }),
    prisma.payment.findMany({
      where: { direction: "IN", status: { in: ["REQUESTED", "PENDING"] } },
      select: { amountCents: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true },
    }),
    prisma.payment.aggregate({ where: { direction: "IN", status: "PAID", method: "MANUAL" }, _sum: { amountCents: true } }),
    prisma.apparelOrderItem.findMany({ where: { payment: { direction: "IN", status: "PAID" } }, select: { unitPriceCents: true, quantity: true } }),
    prisma.payment.aggregate({ where: { direction: "OUT", category: "REFUND", status: "PAID" }, _sum: { amountCents: true } }),
  ]);

  // The paid share of active installment plans is collected money sitting in
  // Stripe even though the plan row is still PENDING — count it as collected and
  // leave only the remainder outstanding, matching the Payments page.
  const installmentPaidCents = outstanding.reduce((s, p) => {
    if (!p.installmentPlan || !p.installmentsPaid) return s;
    const total = p.installmentsTotal ?? 3;
    return s + Math.round((p.amountCents / total) * Math.min(p.installmentsPaid, total));
  }, 0);
  const collected = (collectedAgg._sum.amountCents ?? 0) + installmentPaidCents;
  const requested = Math.max(0, outstanding.reduce((s, p) => s + p.amountCents, 0) - installmentPaidCents);
  const apparelCents = apparelItems.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const manualCollected = manualAgg._sum.amountCents ?? 0;

  const { unix: sinceUnix } = paymentsSince();
  const stripeCollected = await stripeCollectedBreakdown(sinceUnix).catch(() => null);
  const usingStripe = stripeCollected !== null;
  const collectedTotal = usingStripe ? stripeCollected!.totalCents + manualCollected : collected + apparelCents;

  return {
    collectedCents: collectedTotal,
    requestedCents: requested,
    refundedCents: refundAgg._sum.amountCents ?? 0,
    usingStripe,
  };
}
