"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { stripe, isStripeConfigured, appUrl } from "@/lib/stripe";
import { audit } from "@/lib/audit";

/** Book an à la carte offering (§11). Creates a REQUESTED booking for the coach. */
export async function bookOffering(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const offeringId = String(formData.get("offeringId") ?? "");
  const clientId = String(formData.get("clientId") ?? session.personId ?? "");

  const household = await householdPersonIds(session.personId);
  if (!household.includes(clientId)) throw new Error("Not authorized.");

  const offering = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId } });
  if (!offering || !offering.active) throw new Error("Offering unavailable.");

  await prisma.alaCarteBooking.create({
    data: { offeringId, clientId, coachId: offering.coachId, status: "REQUESTED" },
  });
  revalidatePath("/portal/lessons");
}

/**
 * Player-entered availability for a fixture (§14). Player marks Playing or Not
 * playing themselves — not relayed through a coach. Scoped to the household.
 */
export async function confirmAvailability(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const status = String(formData.get("status") ?? "UNCONFIRMED");

  const household = await householdPersonIds(session.personId);
  if (!household.includes(personId)) throw new Error("Not authorized.");

  await prisma.availabilityConfirmation.upsert({
    where: { fixtureId_personId: { fixtureId, personId } },
    create: { fixtureId, personId, status, confirmedAt: new Date() },
    update: { status, confirmedAt: new Date() },
  });
  revalidatePath("/portal");
}

/** Mark a received message as read for the current user's household. */
export async function markMessageRead(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const recipientId = String(formData.get("recipientId") ?? "");
  const household = await householdPersonIds(session.personId);
  // Only mark rows that belong to this household.
  await prisma.messageRecipient.updateMany({
    where: { id: recipientId, personId: { in: household }, readAt: null },
    data: { readAt: new Date(), inAppStatus: "READ" },
  });
  revalidatePath("/portal");
}

/** People this logged-in user may pay for: themselves + their dependents. */
async function householdPersonIds(personId: string | null): Promise<string[]> {
  if (!personId) return [];
  const me = await prisma.person.findUnique({
    where: { id: personId },
    include: { dependents: { select: { id: true } } },
  });
  if (!me) return [];
  return [me.id, ...me.dependents.map((d) => d.id)];
}

/**
 * Begin checkout for a requested payment. Uses Stripe hosted checkout when
 * configured; otherwise simulates a completed payment so the flow is
 * demonstrable in dev. The no-make-up policy disclosure is shown on the payment
 * screen and reaffirmed here in the line-item description (§8).
 */
export async function startCheckout(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const paymentId = String(formData.get("paymentId") ?? "");
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.direction !== "IN") throw new Error("Payment not found.");

  // Authorization: the payment's party must be in the caller's household.
  const household = await householdPersonIds(session.personId);
  if (!payment.partyId || !household.includes(payment.partyId)) {
    throw new Error("Not authorized to pay this invoice.");
  }
  if (payment.status === "PAID") redirect("/portal");

  if (!isStripeConfigured()) {
    // Dev simulation — mark paid directly, clearly flagged in the record.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", method: "STRIPE", paidAt: new Date(), description: (payment.description ?? "") + " [simulated — Stripe not configured]" },
    });
    await audit({ actorId: session.userId, entityType: "Payment", entityId: payment.id, action: "PAID", summary: "Simulated checkout (no Stripe keys)" });
    revalidatePath("/portal");
    redirect("/portal/payment/success?sim=1");
  }

  const checkout = await stripe().checkout.sessions.create({
    mode: "payment",
    // Never collect or store card data ourselves — Stripe hosts the form.
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: payment.amountCents,
          product_data: {
            name: payment.description ?? "PURE Academy season fee",
            description:
              "Reserves a place on a team, not a session count. Individual practices PURE cancels are not refunded or credited.",
          },
        },
      },
    ],
    metadata: { paymentId: payment.id },
    success_url: `${appUrl()}/portal/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/portal/payment/cancel`,
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PENDING", stripeCheckoutId: checkout.id },
  });

  redirect(checkout.url!);
}
