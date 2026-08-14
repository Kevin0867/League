import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createCheckoutRedirect } from "@/lib/payments/checkout";
import { saveApparelForPayment, apparelRequiredFor } from "@/lib/payments/apparel";
import { normalizeCart } from "@/lib/domain/apparel";

// PUBLIC season-fee checkout — no login required. The payment id (an unguessable
// cuid) in the form body is the capability token, so a parent who has no account
// and isn't signed in can still pay from the emailed link. Only ever starts a
// checkout for an existing fee; it exposes nothing and charges nothing on its own.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const paymentId = String(form.get("paymentId") ?? "");
  const plan = String(form.get("plan") ?? "full") === "installments" ? "installments" : "full";

  if (!paymentId) return NextResponse.redirect(new URL("/pay/missing", origin), 303);

  // Team apparel is required for a season fee. Persist the cart (server-priced)
  // before checkout; reject if the fee needs apparel and none was chosen.
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { partyId: true, category: true, coveredPersonIds: true } });
  if (payment && apparelRequiredFor(payment.category)) {
    const allowed = Array.isArray(payment.coveredPersonIds)
      ? (payment.coveredPersonIds as string[])
      : payment.partyId
      ? [payment.partyId]
      : [];
    const lines = normalizeCart(form.get("cart"), allowed);
    if (lines.length === 0) return NextResponse.redirect(new URL(`/pay/${paymentId}?err=apparel`, origin), 303);
    await saveApparelForPayment(paymentId, lines, { personId: payment.partyId, allowedPersonIds: allowed });
  }

  // Admin test: complete without charging. Only honored for a signed-in admin —
  // a public payer can never trigger it.
  let simulate = false;
  if (String(form.get("test") ?? "") === "1") {
    const session = await getSession();
    simulate = !!session && can((session.roles ?? [session.role]) as never, "manageTeams");
  }

  const result = await createCheckoutRedirect({ paymentId, plan, simulate });
  if (!result.ok) {
    if (result.error === "paid") return NextResponse.redirect(new URL(`/pay/${paymentId}`, origin), 303);
    const code = result.error === "stripe" ? "stripe" : "notfound";
    return NextResponse.redirect(new URL(`/pay/${paymentId}?err=${code}`, origin), 303);
  }
  return NextResponse.redirect(result.redirectUrl, 303);
}
