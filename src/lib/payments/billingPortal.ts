import "server-only";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";

// Self-service payment-method management via the Stripe Customer Billing Portal.
// Stripe hosts the page (PCI-handled); the customer updates their card, views
// invoices, and manages their plan there. We only need to resolve their Stripe
// customer and mint a portal session.

/** Resolve the Stripe customer for a household — from Person.stripeCustomerId, a
 *  saved lesson series, or any subscription's customer (backfilling Person for
 *  next time). Returns null when there's nothing on file yet. */
export async function resolveHouseholdStripeCustomer(peopleIds: string[]): Promise<string | null> {
  if (peopleIds.length === 0 || !isStripeConfigured()) return null;

  // Include guardians — a child's fee is usually billed to the parent.
  const persons = await prisma.person.findMany({ where: { id: { in: peopleIds } }, select: { id: true, guardianId: true } });
  const ids = new Set(peopleIds);
  for (const p of persons) if (p.guardianId) ids.add(p.guardianId);
  const idList = [...ids];

  const withCust = await prisma.person.findFirst({ where: { id: { in: idList }, stripeCustomerId: { not: null } }, select: { stripeCustomerId: true } });
  if (withCust?.stripeCustomerId) return withCust.stripeCustomerId;

  const ser = await prisma.lessonSeries.findFirst({ where: { clientId: { in: idList }, stripeCustomerId: { not: null } }, select: { stripeCustomerId: true } });
  if (ser?.stripeCustomerId) return ser.stripeCustomerId;

  // Fall back to a subscription's customer (season-fee payment plan), and cache
  // it on the payer's Person so the next lookup is instant.
  const subPay = await prisma.payment.findFirst({
    where: { stripeSubscriptionId: { not: null }, partyId: { in: idList } },
    select: { stripeSubscriptionId: true, partyId: true },
    orderBy: { createdAt: "desc" },
  });
  if (subPay?.stripeSubscriptionId) {
    try {
      const sub = await stripe().subscriptions.retrieve(subPay.stripeSubscriptionId);
      const cust = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      if (cust && subPay.partyId) await prisma.person.update({ where: { id: subPay.partyId }, data: { stripeCustomerId: cust } }).catch(() => {});
      return cust;
    } catch { /* ignore */ }
  }
  return null;
}

/** Create a Stripe Billing Portal session and return its URL (null on failure —
 *  e.g. the portal isn't enabled in the Stripe Dashboard). */
export async function createBillingPortalUrl(customerId: string, returnUrl: string): Promise<string | null> {
  try {
    const sess = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return sess.url;
  } catch (e) {
    console.error("billing portal session create failed", e);
    return null;
  }
}

/** Sync a customer's new default card onto their active lesson series, so the
 *  next off-session lesson charge uses the card they just updated. Called from
 *  the Stripe webhook on customer.updated. */
export async function syncCustomerDefaultCardToSeries(customerId: string, paymentMethodId: string | null): Promise<void> {
  if (!paymentMethodId) return;
  await prisma.lessonSeries.updateMany({
    where: { stripeCustomerId: customerId, status: "ACTIVE" },
    data: { defaultPaymentMethodId: paymentMethodId },
  });
}
