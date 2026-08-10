import { NextResponse } from "next/server";
import { createCheckoutRedirect } from "@/lib/payments/checkout";

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

  const result = await createCheckoutRedirect({ paymentId, plan });
  if (!result.ok) {
    if (result.error === "paid") return NextResponse.redirect(new URL(`/pay/${paymentId}`, origin), 303);
    return NextResponse.redirect(new URL(`/pay/${paymentId}?err=notfound`, origin), 303);
  }
  return NextResponse.redirect(result.redirectUrl, 303);
}
