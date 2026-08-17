import "server-only";
import { prisma } from "@/lib/db";
import { normalizeCart, unitPriceCents, garmentLabel, sizeLabel, apparelTaxCents, type CartLine } from "@/lib/domain/apparel";

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
  opts: { personId?: string | null; allowedPersonIds?: string[] } = {}
): Promise<CartLine[]> {
  const lines = normalizeCart(rawCart, opts.allowedPersonIds);
  const { shirtCents, tankCents } = await apparelPrices();
  await prisma.apparelOrderItem.deleteMany({ where: { paymentId } });
  if (lines.length) {
    await prisma.apparelOrderItem.createMany({
      data: lines.map((l) => ({
        paymentId,
        // Per-line player if tagged, else the payer (single-player invoices).
        personId: l.personId ?? opts.personId ?? null,
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
  const items = rows.map((a) => ({
    quantity: a.quantity,
    price_data: {
      currency: "usd" as const,
      unit_amount: a.unitPriceCents,
      product_data: { name: `Team ${garmentLabel(a.garment)} — ${sizeLabel(a.size)}` },
    },
  }));
  // 8% sales tax on apparel only — added as its own line so it's charged once
  // alongside the apparel (the season fee itself is never taxed).
  const apparelSubtotal = rows.reduce((s, a) => s + a.unitPriceCents * a.quantity, 0);
  const taxCents = apparelTaxCents(apparelSubtotal);
  if (taxCents > 0) {
    items.push({
      quantity: 1,
      price_data: {
        currency: "usd" as const,
        unit_amount: taxCents,
        product_data: { name: "Sales tax (8% apparel)" },
      },
    });
  }
  return items;
}
