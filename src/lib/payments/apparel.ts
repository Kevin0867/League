import "server-only";
import { prisma } from "@/lib/db";
import { normalizeCart, unitPriceCents, garmentLabel, sizeLabel, type CartLine } from "@/lib/domain/apparel";

/** Current apparel prices (falls back to $25 each if no rate config exists). */
export async function apparelPrices(): Promise<{ shirtCents: number; tankCents: number }> {
  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  return { shirtCents: rate?.shirtPriceCents ?? 2500, tankCents: rate?.tankPriceCents ?? 2500 };
}

/** Team-assigned players must buy apparel; a season fee (PLAYER_FEE) requires it. */
export function apparelRequiredFor(category: string): boolean {
  return category === "PLAYER_FEE";
}

/**
 * Persist the apparel cart for a payment, replacing any prior lines. Prices are
 * looked up server-side — a client-sent price is never trusted. Returns the
 * validated lines (empty if the cart was empty/invalid).
 */
export async function saveApparelForPayment(
  paymentId: string,
  rawCart: unknown,
  opts: { personId?: string | null } = {}
): Promise<CartLine[]> {
  const lines = normalizeCart(rawCart);
  const { shirtCents, tankCents } = await apparelPrices();
  await prisma.apparelOrderItem.deleteMany({ where: { paymentId } });
  if (lines.length) {
    await prisma.apparelOrderItem.createMany({
      data: lines.map((l) => ({
        paymentId,
        personId: opts.personId ?? null,
        garment: l.garment,
        size: l.size,
        quantity: l.quantity,
        unitPriceCents: unitPriceCents(l.garment, shirtCents, tankCents),
      })),
    });
  }
  return lines;
}

/**
 * Stripe one-time line items for a payment's apparel (empty if none). Used in
 * both the pay-in-full and 3-payment checkouts — in subscription mode Stripe
 * bills one-time items on the FIRST invoice only, so apparel is charged once.
 */
export async function apparelLineItems(paymentId: string) {
  const rows = await prisma.apparelOrderItem.findMany({ where: { paymentId }, orderBy: { createdAt: "asc" } });
  return rows.map((a) => ({
    quantity: a.quantity,
    price_data: {
      currency: "usd" as const,
      unit_amount: a.unitPriceCents,
      product_data: { name: `Team ${garmentLabel(a.garment)} — ${sizeLabel(a.size)}` },
    },
  }));
}
