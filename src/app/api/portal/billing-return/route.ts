import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveHouseholdStripeCustomer, currentCustomerCardId, syncCustomerDefaultCardToSeries } from "@/lib/payments/billingPortal";

// The Stripe Billing Portal return URL. When a customer finishes in the portal,
// Stripe sends them back here. We read their current card and point their active
// lesson series at it, so a card changed in the portal is used for upcoming
// off-session lesson charges — no extra Stripe webhook configuration required.
// (Season-fee subscriptions pick up the new card in Stripe automatically.) Then
// we return them to the portal. Authenticated by their own session cookie, and
// only ever touches their own household's customer.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const back = NextResponse.redirect(new URL("/portal?ok=billing", origin), 303);
  try {
    const session = await getSession();
    if (!session?.personId) return back;
    const me = await prisma.person.findUnique({ where: { id: session.personId }, include: { dependents: { select: { id: true } } } });
    const peopleIds = me ? [me.id, ...me.dependents.map((d) => d.id)] : [];
    const customerId = await resolveHouseholdStripeCustomer(peopleIds);
    if (!customerId) return back;
    const cardId = await currentCustomerCardId(customerId);
    await syncCustomerDefaultCardToSeries(customerId, cardId);
  } catch (e) {
    console.error("billing-return sync failed", e);
  }
  return back;
}
