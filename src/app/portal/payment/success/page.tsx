import Link from "next/link";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/money";
import { loadReceipt, ACADEMY_LOGO, PADEL_LOGO } from "@/lib/payments/receipt";

export const dynamic = "force-dynamic";

// Confirms and reflects payment. The webhook is the source of truth, but we also
// reconcile here so the UI is correct immediately on redirect back from Stripe.
export default async function PaymentSuccess({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; sim?: string; payment?: string }>;
}) {
  const { session_id, sim, payment } = await searchParams;

  // Resolve the paymentId (from the Stripe session metadata, or the sim param).
  let paymentId: string | null = payment ?? null;
  if (session_id && isStripeConfigured()) {
    try {
      const cs = await stripe().checkout.sessions.retrieve(session_id);
      paymentId = cs.metadata?.paymentId ?? paymentId;
      // Upfront (one-time) payments settle immediately; reconcile here too.
      if (paymentId && cs.mode === "payment" && cs.payment_status === "paid") {
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

  const receipt = paymentId ? await loadReceipt(paymentId) : null;
  const installments = receipt?.plan === "INSTALLMENTS_3";

  return (
    <div className="mx-auto max-w-lg py-10">
      {/* Brand header: PURE Academy (left) + PURE Pickleball & Padel (right) */}
      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ACADEMY_LOGO} alt="PURE Academy" className="h-9 w-auto rounded-md" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PADEL_LOGO} alt="PURE Pickleball & Padel" className="h-10 w-auto" />
      </div>

      <div className="card text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl">✓</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          {installments ? "You're enrolled!" : "Payment received"}
        </h1>
        <p className="mt-1 text-slate-600">
          {sim
            ? "Simulated payment recorded (Stripe not configured in this environment)."
            : installments
            ? `Thanks${receipt ? ", " + receipt.name : ""}! Your spot is reserved and your payment plan is set.`
            : `Thanks${receipt ? ", " + receipt.name : ""}! Your season fee is paid. You're all set.`}
        </p>

        {receipt && (
          <div className="mt-6 text-left">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{receipt.seasonName}</h2>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {receipt.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{it.division}</span>
                  <span className="text-slate-500">{it.program}</span>
                </li>
              ))}
              {receipt.items.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-500">Academy registration</li>
              )}
            </ul>

            <div className="mt-4 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              {installments ? (
                <>
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
                    <span>Total</span>
                    <span>{formatCents(receipt.amountCents)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">3 payments — the first today, then 30 and 60 days later (charged automatically):</p>
                  <ul className="mt-2 space-y-1">
                    {receipt.installments.map((p, i) => (
                      <li key={i} className="flex items-center justify-between text-sm text-slate-600">
                        <span>Payment {i + 1} · {p.date}</span>
                        <span className="font-medium text-slate-800">{formatCents(p.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
                  <span>Paid in full</span>
                  <span>{formatCents(receipt.amountCents)}</span>
                </div>
              )}
            </div>

            <p className="mt-4 text-center text-xs text-slate-400">A copy of this confirmation has been emailed to you.</p>
            <p className="mt-1 text-center text-xs text-slate-400">
              Any issues, please contact us at{" "}
              <a href={`mailto:${receipt.supportEmail}`} className="text-accent-700 underline">{receipt.supportEmail}</a>
              {receipt.supportPhone ? ` or ${receipt.supportPhone}` : ""}.
            </p>
          </div>
        )}

        <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
      </div>
    </div>
  );
}
