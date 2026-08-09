import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { stripe, isStripeConfigured, appUrl } from "@/lib/stripe";
import {
  INSTALLMENT_COUNT,
  installmentChargeDates,
  splitInstallments,
  sendPaymentConfirmation,
} from "@/lib/payments/receipt";
import { audit } from "@/lib/audit";

// Player-portal mutations as native-form-POST route handlers with ticket auth.
// Route handlers 303-redirect to a fresh GET (which carries the session cookie),
// so unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the portal layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

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

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  // The ticket only proves an authenticated user; resolve the acting person.
  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { personId: true, id: true },
  });
  const personId = me?.personId ?? null;

  const op = String(formData.get("op") ?? "");

  switch (op) {
    // Book an à la carte offering (§11). Creates a REQUESTED booking for the coach.
    case "bookOffering": {
      const offeringId = String(formData.get("offeringId") ?? "");
      const clientId = String(formData.get("clientId") ?? personId ?? "");

      const household = await householdPersonIds(personId);
      if (!household.includes(clientId)) throw new Error("Not authorized.");

      const offering = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId } });
      if (!offering || !offering.active) throw new Error("Offering unavailable.");

      await prisma.alaCarteBooking.create({
        data: { offeringId, clientId, coachId: offering.coachId, status: "REQUESTED" },
      });
      return NextResponse.redirect(new URL("/portal/lessons", origin), 303);
    }

    // Player-entered availability for a fixture (§14). Player marks Playing or Not
    // playing themselves — not relayed through a coach. Scoped to the household.
    case "confirmAvailability": {
      const fixtureId = String(formData.get("fixtureId") ?? "");
      const confirmPersonId = String(formData.get("personId") ?? "");
      const status = String(formData.get("status") ?? "UNCONFIRMED");

      const household = await householdPersonIds(personId);
      if (!household.includes(confirmPersonId)) throw new Error("Not authorized.");

      await prisma.availabilityConfirmation.upsert({
        where: { fixtureId_personId: { fixtureId, personId: confirmPersonId } },
        create: { fixtureId, personId: confirmPersonId, status, confirmedAt: new Date() },
        update: { status, confirmedAt: new Date() },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    // Mark a received message as read for the current user's household.
    case "markMessageRead": {
      const recipientId = String(formData.get("recipientId") ?? "");
      const household = await householdPersonIds(personId);
      // Only mark rows that belong to this household.
      await prisma.messageRecipient.updateMany({
        where: { id: recipientId, personId: { in: household }, readAt: null },
        data: { readAt: new Date(), inAppStatus: "READ" },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    /**
     * Begin checkout for a requested payment. Uses Stripe hosted checkout when
     * configured; otherwise simulates a completed payment so the flow is
     * demonstrable in dev. The no-make-up policy disclosure is shown on the payment
     * screen and reaffirmed here in the line-item description (§8).
     */
    case "startCheckout": {
      const paymentId = String(formData.get("paymentId") ?? "");
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.direction !== "IN") throw new Error("Payment not found.");

      // Authorization: the payment's party must be in the caller's household.
      const household = await householdPersonIds(personId);
      if (!payment.partyId || !household.includes(payment.partyId)) {
        throw new Error("Not authorized to pay this invoice.");
      }
      if (payment.status === "PAID") return NextResponse.redirect(new URL("/portal", origin), 303);

      // Payment plan: pay in full (one charge now) or 3 equal monthly charges.
      const installments = String(formData.get("plan") ?? "full") === "installments";
      const success = `${appUrl()}/portal/payment/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancel = `${appUrl()}/portal/payment/cancel`;
      const productName = payment.description ?? "PURE Academy season fee";
      const productBlurb =
        "Reserves a place on a team, not a session count. Individual practices PURE cancels are not refunded or credited.";

      if (!isStripeConfigured()) {
        // Dev simulation — no real charge; record the plan and confirm, clearly flagged.
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
        await audit({ actorId: actor.userId, entityType: "Payment", entityId: payment.id, action: installments ? "SCHEDULED" : "PAID", summary: "Simulated checkout (no Stripe keys)" });
        await sendPaymentConfirmation(payment.id);
        return NextResponse.redirect(
          new URL(`/portal/payment/success?sim=1&payment=${payment.id}`, origin),
          303
        );
      }

      if (installments) {
        // Save the card and schedule 3 equal monthly charges. The first charge
        // is deferred to season start + 1 month via trial_end; the webhook
        // cancels the subscription after the 3rd invoice clears.
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
          subscription_data: {
            trial_end: trialEnd,
            metadata: { paymentId: payment.id },
            description: productBlurb,
          },
          metadata: { paymentId: payment.id },
          success_url: success,
          cancel_url: cancel,
        });

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "PENDING",
            installmentPlan: true,
            installmentsTotal: INSTALLMENT_COUNT,
            stripeCheckoutId: checkout.id,
          },
        });
        return NextResponse.redirect(checkout.url!, 303);
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

      return NextResponse.redirect(checkout.url!, 303);
    }

    default:
      return NextResponse.redirect(new URL("/portal", origin), 303);
  }
}
