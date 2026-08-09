import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";

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
      const s = event.data.object as { id: string; payment_intent?: string; metadata?: { paymentId?: string } };
      const paymentId = s.metadata?.paymentId;
      if (paymentId) {
        await prisma.payment.updateMany({
          where: { id: paymentId, status: { not: "PAID" } },
          data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: s.payment_intent ?? null },
        });
        await audit({ entityType: "Payment", entityId: paymentId, action: "PAID", summary: "Stripe checkout completed" });
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
