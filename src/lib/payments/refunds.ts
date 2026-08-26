import "server-only";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { audit } from "@/lib/audit";

// One place that records Stripe refunds against a local payment, used by the
// webhook (real-time), the in-app Refund button, and the nightly reconcile.
// Idempotent by the Stripe refund id (Payment.stripeRefundId, unique): each
// refund is booked once as an OUT/REFUND row, and the original is marked
// REFUNDED once it's fully refunded — no matter which path sees it first.

export type OriginalPayment = {
  id: string;
  partyId: string | null;
  seasonId: string | null;
  amountCents: number;
  status: string;
  description: string | null;
};

/**
 * Ensure every succeeded refund on `chargeId` is booked against `original`.
 * `chargeAmount` / `chargeAmountRefunded` come from the Stripe charge and decide
 * whether the original is now fully refunded. Returns how many new refund rows
 * were created and whether the original was flipped to REFUNDED.
 */
export async function syncRefundsForCharge(
  original: OriginalPayment,
  chargeId: string,
  chargeAmount: number,
  chargeAmountRefunded: number,
): Promise<{ created: number; createdCents: number; fullyRefunded: boolean }> {
  const refunds = await stripe().refunds.list({ charge: chargeId, limit: 100 });
  let created = 0;
  let createdCents = 0;

  for (const r of refunds.data) {
    if (r.status !== "succeeded") continue;
    // Idempotent: skip a refund we've already booked (either path).
    const exists = await prisma.payment.findUnique({ where: { stripeRefundId: r.id } });
    if (exists) continue;
    await prisma.payment.create({
      data: {
        direction: "OUT",
        partyId: original.partyId,
        amountCents: r.amount,
        method: "STRIPE",
        status: "PAID",
        category: "REFUND",
        seasonId: original.seasonId,
        paidAt: new Date((r.created ?? Math.floor(Date.now() / 1000)) * 1000),
        description: `Refund — ${original.description ?? "payment"}`,
        stripeRefundId: r.id,
      },
    });
    created++;
    createdCents += r.amount;
    await audit({
      entityType: "Payment",
      entityId: original.id,
      action: "REFUND_RECORDED",
      summary: `Recorded Stripe refund of ${(r.amount / 100).toFixed(2)}${r.id ? ` (${r.id})` : ""}`,
    });
  }

  const fullyRefunded = chargeAmount > 0 && chargeAmountRefunded >= chargeAmount;
  if (fullyRefunded && original.status !== "REFUNDED") {
    await prisma.payment.update({ where: { id: original.id }, data: { status: "REFUNDED" } });
  }
  return { created, createdCents, fullyRefunded };
}

/** Look up the local inbound payment for a Stripe payment intent. */
export async function paymentForIntent(paymentIntentId: string): Promise<OriginalPayment | null> {
  const p = await prisma.payment.findFirst({
    where: { direction: "IN", stripePaymentIntentId: paymentIntentId },
    select: { id: true, partyId: true, seasonId: true, amountCents: true, status: true, description: true },
  });
  return p;
}
