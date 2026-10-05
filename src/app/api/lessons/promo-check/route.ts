import { NextResponse } from "next/server";
import { checkPromo } from "@/lib/domain/promo";

// PUBLIC: validate a promo code against an order amount so the booking wizard can
// preview the discount before checkout. Does not redeem — redemption happens when
// the booking is created.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const amountCents = Math.max(0, parseInt(url.searchParams.get("amount") ?? "0", 10) || 0);
  if (!code.trim() || !amountCents) return NextResponse.json({ ok: false, reason: "Enter a code." });
  const r = await checkPromo(code, amountCents);
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason });
  return NextResponse.json({ ok: true, discountCents: r.discountCents, label: r.label });
}
