import "server-only";
import { prisma } from "@/lib/db";

// Lesson promo codes: validate a code against an order amount and compute the
// discount. Codes are stored UPPERCASE and matched case-insensitively. A code is
// valid when active, unexpired, under its redemption cap, and the order meets any
// minimum. Discount never exceeds the order (no negative charges).

export type PromoRow = { id: string; code: string; kind: string; value: number; minAmountCents: number | null };

export function promoDiscountCents(promo: { kind: string; value: number }, amountCents: number): number {
  const d = promo.kind === "PERCENT"
    ? Math.round(amountCents * (Math.min(100, Math.max(0, promo.value)) / 100))
    : Math.max(0, promo.value);
  return Math.min(d, amountCents);
}

export type PromoCheck =
  | { ok: true; promo: PromoRow; discountCents: number; label: string }
  | { ok: false; reason: string };

/** Validate a code for an order of `amountCents`. Does not redeem. */
export async function checkPromo(codeRaw: string, amountCents: number): Promise<PromoCheck> {
  const code = (codeRaw ?? "").trim().toUpperCase();
  if (!code) return { ok: false, reason: "Enter a promo code." };
  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo || !promo.active) return { ok: false, reason: "That code isn't valid." };
  if (promo.expiresAt && promo.expiresAt < new Date()) return { ok: false, reason: "That code has expired." };
  if (promo.maxRedemptions != null && promo.timesRedeemed >= promo.maxRedemptions) return { ok: false, reason: "That code has been fully redeemed." };
  if (promo.minAmountCents != null && amountCents < promo.minAmountCents) return { ok: false, reason: `This code needs an order of at least $${(promo.minAmountCents / 100).toFixed(2)}.` };
  const discountCents = promoDiscountCents(promo, amountCents);
  if (discountCents <= 0) return { ok: false, reason: "That code gives no discount on this order." };
  const label = promo.kind === "PERCENT" ? `${promo.value}% off` : `$${(promo.value / 100).toFixed(2)} off`;
  return { ok: true, promo: { id: promo.id, code: promo.code, kind: promo.kind, value: promo.value, minAmountCents: promo.minAmountCents }, discountCents, label };
}

/** Record one redemption (atomic increment, respecting the cap). Returns true if counted. */
export async function redeemPromo(promoId: string): Promise<boolean> {
  const r = await prisma.promoCode.updateMany({
    where: { id: promoId, OR: [{ maxRedemptions: null }, { timesRedeemed: { lt: prisma.promoCode.fields.maxRedemptions } }] },
    data: { timesRedeemed: { increment: 1 } },
  }).catch(() => ({ count: 0 }));
  return r.count > 0;
}
