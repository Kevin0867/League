import "server-only";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured, appUrl } from "@/lib/stripe";
import { INSTALLMENT_COUNT, INSTALLMENT_INTERVAL_DAYS, sendPaymentConfirmation } from "@/lib/payments/receipt";
import { apparelLineItems } from "@/lib/payments/apparel";
import { audit } from "@/lib/audit";

// Shared season-fee checkout. Used by both the authenticated portal (which adds
// a household authorization check before calling this) and the PUBLIC pay page
// linked from the fee-request email — a payer may have no account and not be
// logged in, so the payment id (an unguessable cuid) is the capability token.
// Success/cancel land on the PUBLIC /pay/* pages so a logged-out payer is never
// bounced to a login wall after paying.

export type CheckoutError = "notfound" | "paid" | "stripe";
export type CheckoutResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: CheckoutError; detail?: string };

export async function createCheckoutRedirect(opts: {
  paymentId: string;
  plan: "full" | "installments";
  actorId?: string | null;
  /** Admin test: complete the payment WITHOUT charging (same path used when
   *  Stripe isn't configured) so staff can exercise the full flow safely. */
  simulate?: boolean;
}): Promise<CheckoutResult> {
  const { paymentId, plan, actorId = null, simulate = false } = opts;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.direction !== "IN") return { ok: false, error: "notfound" };
  if (payment.status === "PAID") return { ok: false, error: "paid" };

  // An apparel-only order has no season-fee line — the apparel items ARE the
  // charge — and never installments.
  const isApparelOnly = payment.category === "APPAREL";
  const installments = plan === "installments" && !isApparelOnly;
  const base = appUrl();
  const success = `${base}/pay/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${base}/pay/${payment.id}?canceled=1`;
  const isAlaCarte = payment.category === "ALA_CARTE";
  // Admin-created one-off charges (custom / ACP entry) get a neutral blurb and
  // use the description verbatim as the product name.
  const isCustom = payment.category === "CUSTOM" || payment.category === "ACP_ENTRY";
  const productName =
    payment.description ?? (isAlaCarte ? "PURE Academy clinic" : isCustom ? "PURE Academy payment" : "PURE Academy season fee");
  const productBlurb = isAlaCarte
    ? "Reserves your spot for this session. Your place is confirmed once payment clears."
    : isCustom
    ? "Payment to PURE Academy / Arizona Club Pickleball."
    : "Reserves a place on a team, not a session count. Individual practices PURE cancels are not refunded or credited.";

  // Dev / unconfigured Stripe, or an explicit admin test — simulate a successful
  // charge, clearly flagged, with no money moved.
  if (simulate || !isStripeConfigured()) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        method: "STRIPE",
        installmentPlan: installments,
        installmentsTotal: installments ? INSTALLMENT_COUNT : null,
        // First installment is charged at registration, so it's already 1/3 paid.
        installmentsPaid: installments ? 1 : 0,
        status: installments ? "PENDING" : "PAID",
        paidAt: installments ? null : new Date(),
        description: (payment.description ?? "") + " [simulated — Stripe not configured]",
      },
    });
    await audit({ actorId, entityType: "Payment", entityId: payment.id, action: installments ? "SCHEDULED" : "PAID", summary: "Simulated checkout (no Stripe keys)" });
    await sendPaymentConfirmation(payment.id);
    return { ok: true, redirectUrl: `${base}/pay/success?sim=1&payment=${payment.id}` };
  }

  // Team apparel bought with this fee — one-time line items charged once, added
  // to both the pay-in-full checkout and the FIRST invoice of the payment plan.
  const apparel = await apparelLineItems(payment.id);

  // An apparel-only order is nothing but its apparel lines — guard against an
  // empty cart reaching Stripe (the pay route already rejects this upstream).
  if (isApparelOnly && apparel.length === 0) return { ok: false, error: "notfound" };

  try {
    if (installments) {
      // 3-payment plan anchored at registration: the FIRST charge is taken now at
      // checkout, then two more every 30 days (≈ +30 and +60 days). The webhook
      // counts each cleared invoice and cancels the subscription after the 3rd.
      const perCharge = Math.round(payment.amountCents / INSTALLMENT_COUNT);

      const checkout = await stripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: perCharge,
              recurring: { interval: "day", interval_count: INSTALLMENT_INTERVAL_DAYS },
              product_data: { name: `${productName} — 3-payment plan` },
            },
          },
          ...apparel,
        ],
        subscription_data: { metadata: { paymentId: payment.id }, description: productBlurb },
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
        ...apparel,
      ],
      metadata: { paymentId: payment.id },
      // Also stamp the id on the PaymentIntent so the charge itself is traceable
      // back to this Payment (reconciliation / debugging), not just the session.
      payment_intent_data: { metadata: { paymentId: payment.id } },
      success_url: success,
      cancel_url: cancel,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PENDING", installmentPlan: false, stripeCheckoutId: checkout.id },
    });
    return { ok: true, redirectUrl: checkout.url! };
  } catch (e) {
    // A Stripe failure must never become a blank 500 — surface a clear reason.
    console.error("Stripe checkout create failed", e);
    return { ok: false, error: "stripe", detail: e instanceof Error ? e.message : "Payment provider error" };
  }
}
