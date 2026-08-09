import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";
import { sendPaymentConfirmation } from "@/lib/payments/receipt";

// Stripe webhook — the source of truth for payment completion. We verify the
// signature and mark the Payment PAID on checkout.session.completed. Card data
// never passes through here.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event;
  try {
    if (secret && sig) {
      event = stripe().webhooks.constructEvent(raw, sig, secret);
    } else {
      // No signing secret configured — parse without verification (dev only).
      event = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as {
        id: string;
        mode?: string;
        subscription?: string;
        payment_intent?: string;
        metadata?: { paymentId?: string };
      };
      const paymentId = s.metadata?.paymentId;
      if (paymentId) {
        if (s.mode === "subscription") {
          // 3-payment plan: enrollment confirmed, card saved; charges bill later.
          await prisma.payment.updateMany({
            where: { id: paymentId },
            data: { stripeSubscriptionId: s.subscription ?? null, method: "STRIPE" },
          });
          await audit({ entityType: "Payment", entityId: paymentId, action: "SCHEDULED", summary: "Stripe subscription (3-payment plan) started" });
        } else {
          await prisma.payment.updateMany({
            where: { id: paymentId, status: { not: "PAID" } },
            data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: s.payment_intent ?? null },
          });
          await audit({ entityType: "Payment", entityId: paymentId, action: "PAID", summary: "Stripe checkout completed" });
        }
        await sendPaymentConfirmation(paymentId);
      }
      break;
    }
    case "invoice.paid": {
      // An installment cleared. Advance the count; when all are paid, mark the
      // Payment PAID and cancel the subscription so no further charges occur.
      const inv = event.data.object as { subscription?: string; payment_intent?: string };
      if (inv.subscription) {
        const payment = await prisma.payment.findFirst({ where: { stripeSubscriptionId: inv.subscription } });
        if (payment) {
          const paidCount = payment.installmentsPaid + 1;
          const total = payment.installmentsTotal ?? 3;
          const done = paidCount >= total;
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              installmentsPaid: paidCount,
              ...(done ? { status: "PAID", paidAt: new Date() } : {}),
              stripePaymentIntentId: inv.payment_intent ?? payment.stripePaymentIntentId,
            },
          });
          await audit({ entityType: "Payment", entityId: payment.id, action: "INSTALLMENT_PAID", summary: `Installment ${paidCount}/${total} paid` });
          if (done) {
            try { await stripe().subscriptions.cancel(inv.subscription); } catch (e) { console.error("sub cancel failed", e); }
          }
        }
      }
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as { subscription?: string };
      if (inv.subscription) {
        await prisma.payment.updateMany({
          where: { stripeSubscriptionId: inv.subscription, status: { not: "PAID" } },
          data: { status: "FAILED" },
        });
      }
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const s = event.data.object as { metadata?: { paymentId?: string } };
      const paymentId = s.metadata?.paymentId;
      if (paymentId) {
        await prisma.payment.updateMany({
          where: { id: paymentId, status: "PENDING" },
          data: { status: "REQUESTED" },
        });
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
