import Link from "next/link";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Confirms and reflects payment. The webhook is the source of truth, but we also
// reconcile here so the UI is correct immediately on redirect back from Stripe.
export default async function PaymentSuccess({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; sim?: string }>;
}) {
  const { session_id, sim } = await searchParams;

  if (session_id && isStripeConfigured()) {
    try {
      const cs = await stripe().checkout.sessions.retrieve(session_id);
      const paymentId = cs.metadata?.paymentId;
      if (paymentId && cs.payment_status === "paid") {
        await prisma.payment.updateMany({
          where: { id: paymentId, status: { not: "PAID" } },
          data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: String(cs.payment_intent ?? "") || null },
        });
        await audit({ entityType: "Payment", entityId: paymentId, action: "PAID", summary: "Reconciled on success redirect" });
      }
    } catch (e) {
      console.error("reconcile failed", e);
    }
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">✓</div>
      <h1 className="mt-6 text-2xl font-bold text-slate-900">Payment received</h1>
      <p className="mt-2 text-slate-600">
        {sim
          ? "Simulated payment recorded (Stripe not configured in this environment)."
          : "Thanks! Your season fee is paid. You're all set."}
      </p>
      <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
    </div>
  );
}
