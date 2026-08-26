import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";

// Reconcile local Payment rows against Stripe — the safety net for payments that
// were completed in Stripe but never marked PAID here (a missed / mis-signed
// webhook, an expired-then-paid session, etc.). "Collected" revenue sums PAID
// rows, so an unrecorded payment silently underreports. This asks Stripe the
// true status of every not-yet-PAID Stripe payment and records what it finds.
//
// Read-mostly and idempotent: it only ever moves a row toward what Stripe says
// (→ PAID, or advances installment counts). It never marks anything paid that
// Stripe doesn't confirm, and it re-runs safely.

export type ReconcileResult = {
  scanned: number;
  updated: number;
  nowPaid: number;
  recoveredCents: number;
  errors: number;
  details: Array<{ paymentId: string; note: string; amountCents: number; nowPaid: boolean }>;
};

type PaymentRow = {
  id: string;
  amountCents: number;
  status: string;
  paidAt: Date | null;
  installmentPlan: boolean;
  installmentsPaid: number;
  installmentsTotal: number | null;
  stripeCheckoutId: string | null;
  stripePaymentIntentId: string | null;
  stripeSubscriptionId: string | null;
};

const paidAtFromUnix = (secs: number | null | undefined): Date | null =>
  secs ? new Date(secs * 1000) : null;

/** Inspect one payment against Stripe and update it if Stripe shows more than we have. */
async function reconcileOne(
  p: PaymentRow,
): Promise<{ updated: boolean; nowPaid: boolean; recoveredCents: number; note: string }> {
  const client = stripe();

  // Pull the checkout session when we have its id — it tells us the mode
  // (one-time vs subscription), the payment status, and the linked objects.
  let session: Stripe.Checkout.Session | null = null;
  if (p.stripeCheckoutId) {
    try {
      session = await client.checkout.sessions.retrieve(p.stripeCheckoutId);
    } catch {
      session = null; // session may have aged out of Stripe; fall through to other keys
    }
  }

  const subId =
    p.stripeSubscriptionId ??
    (session?.mode === "subscription" ? (session.subscription as string | null) : null);

  // ---- Installment plan (Stripe subscription) ----
  if (p.installmentPlan || session?.mode === "subscription" || subId) {
    if (!subId) return { updated: false, nowPaid: false, recoveredCents: 0, note: "no subscription linked" };
    const invoices = await client.invoices.list({ subscription: subId, limit: 100 });
    const paidInvoices = invoices.data.filter((i) => i.status === "paid");
    const paidCount = paidInvoices.length;
    const total = p.installmentsTotal ?? 3;
    const done = total > 0 && paidCount >= total;
    const wasPaid = p.status === "PAID";
    const changed = paidCount !== p.installmentsPaid || (done && !wasPaid) || (subId !== p.stripeSubscriptionId);
    if (!changed) return { updated: false, nowPaid: false, recoveredCents: 0, note: "in sync" };

    const lastPaidAt = paidAtFromUnix(paidInvoices[paidInvoices.length - 1]?.status_transitions?.paid_at ?? null);
    await prisma.payment.update({
      where: { id: p.id },
      data: {
        installmentsPaid: paidCount,
        stripeSubscriptionId: subId,
        ...(done ? { status: "PAID", paidAt: p.paidAt ?? lastPaidAt ?? new Date() } : {}),
      },
    });
    await audit({
      entityType: "Payment",
      entityId: p.id,
      action: "RECONCILED",
      summary: `Reconciled with Stripe — installments ${paidCount}/${total}${done ? " (paid in full)" : ""}`,
    });
    return {
      updated: true,
      nowPaid: done && !wasPaid,
      recoveredCents: done && !wasPaid ? p.amountCents : 0,
      note: `installments ${paidCount}/${total}`,
    };
  }

  // ---- One-time checkout ----
  if (session && session.payment_status === "paid" && p.status !== "PAID") {
    const piId = (session.payment_intent as string | null) ?? p.stripePaymentIntentId;
    let paidAt: Date | null = null;
    if (piId) {
      try {
        const pi = await client.paymentIntents.retrieve(piId);
        paidAt = paidAtFromUnix(pi.created);
      } catch {
        /* keep paidAt null → falls back to now */
      }
    }
    await prisma.payment.update({
      where: { id: p.id },
      data: { status: "PAID", paidAt: p.paidAt ?? paidAt ?? new Date(), stripePaymentIntentId: piId ?? undefined },
    });
    await audit({ entityType: "Payment", entityId: p.id, action: "RECONCILED", summary: "Reconciled with Stripe — checkout paid" });
    return { updated: true, nowPaid: true, recoveredCents: p.amountCents, note: "checkout paid" };
  }

  // ---- Fallback: a stored payment intent that succeeded ----
  if (!session && p.stripePaymentIntentId && p.status !== "PAID") {
    const pi = await client.paymentIntents.retrieve(p.stripePaymentIntentId);
    if (pi.status === "succeeded") {
      await prisma.payment.update({
        where: { id: p.id },
        data: { status: "PAID", paidAt: p.paidAt ?? paidAtFromUnix(pi.created) ?? new Date() },
      });
      await audit({ entityType: "Payment", entityId: p.id, action: "RECONCILED", summary: "Reconciled with Stripe — payment intent succeeded" });
      return { updated: true, nowPaid: true, recoveredCents: p.amountCents, note: "payment intent succeeded" };
    }
  }

  return { updated: false, nowPaid: false, recoveredCents: 0, note: "no change (Stripe not paid)" };
}

/**
 * Reconcile every inbound Stripe payment that isn't already recorded as PAID.
 * Returns a summary of what changed. Safe to run repeatedly.
 */
export async function reconcileStripePayments(opts?: { sinceDays?: number; limit?: number }): Promise<ReconcileResult> {
  const res: ReconcileResult = { scanned: 0, updated: 0, nowPaid: 0, recoveredCents: 0, errors: 0, details: [] };
  if (!isStripeConfigured()) return res;

  const since = new Date(Date.now() - (opts?.sinceDays ?? 365) * 86400_000);
  const candidates = (await prisma.payment.findMany({
    where: {
      direction: "IN",
      method: "STRIPE",
      status: { in: ["REQUESTED", "PENDING", "FAILED"] },
      createdAt: { gte: since },
      OR: [
        { stripeCheckoutId: { not: null } },
        { stripeSubscriptionId: { not: null } },
        { stripePaymentIntentId: { not: null } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 1000,
    select: {
      id: true, amountCents: true, status: true, paidAt: true,
      installmentPlan: true, installmentsPaid: true, installmentsTotal: true,
      stripeCheckoutId: true, stripePaymentIntentId: true, stripeSubscriptionId: true,
    },
  })) as PaymentRow[];

  for (const p of candidates) {
    res.scanned++;
    try {
      const r = await reconcileOne(p);
      if (r.updated) {
        res.updated++;
        if (r.nowPaid) res.nowPaid++;
        res.recoveredCents += r.recoveredCents;
        res.details.push({ paymentId: p.id, note: r.note, amountCents: p.amountCents, nowPaid: r.nowPaid });
      }
    } catch (e) {
      res.errors++;
      console.error(`reconcile failed for payment ${p.id}`, e);
    }
  }
  return res;
}
