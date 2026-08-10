import "server-only";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured, appUrl } from "@/lib/stripe";
import { INSTALLMENT_COUNT, installmentChargeDates, sendPaymentConfirmation } from "@/lib/payments/receipt";
import { audit } from "@/lib/audit";

// Shared season-fee checkout. Used by both the authenticated portal (which adds
// a household authorization check before calling this) and the PUBLIC pay page
// linked from the fee-request email — a payer may have no account and not be
// logged in, so the payment id (an unguessable cuid) is the capability token.
// Success/cancel land on the PUBLIC /pay/* pages so a logged-out payer is never
// bounced to a login wall after paying.

export type CheckoutResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: "notfound" | "paid" };

export async function createCheckoutRedirect(opts: {
  paymentId: string;
  plan: "full" | "installments";
  actorId?: string | null;
}): Promise<CheckoutResult> {
  const { paymentId, plan, actorId = null } = opts;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.direction !== "IN") return { ok: false, error: "notfound" };
  if (payment.status === "PAID") return { ok: false, error: "paid" };

  const installments = plan === "installments";
  const base = appUrl();
  const success = `${base}/pay/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${base}/pay/${payment.id}?canceled=1`;
  const isAlaCarte = payment.category === "ALA_CARTE";
  const productName = payment.description ?? (isAlaCarte ? "PURE Academy clinic" : "PURE Academy season fee");
  const productBlurb = isAlaCarte
    ? "Reserves your spot for this session. Your place is confirmed once payment clears."
    : "Reserves a place on a team, not a session count. Individual practices PURE cancels are not refunded or credited.";

  // Dev / unconfigured Stripe — simulate a successful charge, clearly flagged.
  if (!isStripeConfigured()) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        method: "STRIPE",
        installmentPlan: installments,
        installmentsTotal: installments ? INSTALLMENT_COUNT : null,
        status: installments ? "PENDING" : "PAID",
        paidAt: installments ? null : new Date(),
        description: (payment.description ?? "") + " [simulated — Stripe not configured]",
      },
    });
    await audit({ actorId, entityType: "Payment", entityId: payment.id, action: installments ? "SCHEDULED" : "PAID", summary: "Simulated checkout (no Stripe keys)" });
    await sendPaymentConfirmation(payment.id);
    return { ok: true, redirectUrl: `${base}/pay/success?sim=1&payment=${payment.id}` };
  }

  if (installments) {
    // Save the card and schedule 3 equal monthly charges; the first is deferred
    // to season start + 1 month, and the webhook cancels after the 3rd clears.
    const seasonStart = payment.seasonId
      ? (await prisma.season.findUnique({ where: { id: payment.seasonId } }))?.startDate ?? new Date()
      : new Date();
    const firstCharge = installmentChargeDates(seasonStart)[0];
    const trialEnd = Math.max(
      Math.floor(firstCharge.getTime() / 1000),
      Math.floor(Date.now() / 1000) + 3600
    );
    const perCharge = Math.round(payment.amountCents / INSTALLMENT_COUNT);

    const checkout = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: perCharge,
            recurring: { interval: "month" },
            product_data: { name: `${productName} — 3-payment plan` },
          },
        },
      ],
      subscription_data: { trial_end: trialEnd, metadata: { paymentId: payment.id }, description: productBlurb },
      metadata: { paymentId: payment.id },
      success_url: success,
      cancel_url: cancel,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PENDING", installmentPlan: true, installmentsTotal: INSTALLMENT_COUNT, stripeCheckoutId: checkout.id },
    });
    return { ok: true, redirectUrl: checkout.url! };
  }

  // Pay in full — one hosted-checkout charge now.
  const checkout = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: payment.amountCents,
          product_data: { name: productName, description: productBlurb },
        },
      },
    ],
    metadata: { paymentId: payment.id },
    success_url: success,
    cancel_url: cancel,
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PENDING", installmentPlan: false, stripeCheckoutId: checkout.id },
  });
  return { ok: true, redirectUrl: checkout.url! };
}
