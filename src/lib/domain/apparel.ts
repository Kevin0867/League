// Team apparel — every team-assigned player buys at least one item (T-shirt or
// tank top) bundled with their season fee. Shared by the pay-page picker
// (client) and the checkout/order code (server), so this file stays free of
// server-only imports.

export const APPAREL_GARMENTS = [
  { key: "SHIRT", label: "T-shirt" },
  { key: "TANK", label: "Tank top" },
] as const;

export type Garment = (typeof APPAREL_GARMENTS)[number]["key"];

export const APPAREL_SIZES = [
  { key: "YS", label: "Youth S" },
  { key: "YM", label: "Youth M" },
  { key: "YL", label: "Youth L" },
  { key: "YXL", label: "Youth XL" },
  { key: "AXS", label: "Adult XS" },
  { key: "AS", label: "Adult S" },
  { key: "AM", label: "Adult M" },
  { key: "AL", label: "Adult L" },
  { key: "AXL", label: "Adult XL" },
  { key: "A2XL", label: "Adult 2XL" },
] as const;

export type SizeKey = (typeof APPAREL_SIZES)[number]["key"];

const GARMENT_KEYS = new Set(APPAREL_GARMENTS.map((g) => g.key));
const SIZE_KEYS = new Set(APPAREL_SIZES.map((s) => s.key));

export function garmentLabel(g: string): string {
  return APPAREL_GARMENTS.find((x) => x.key === g)?.label ?? g;
}
export function sizeLabel(s: string): string {
  return APPAREL_SIZES.find((x) => x.key === s)?.label ?? s;
}

/** Per-item price for a garment given the configured shirt/tank prices. */
export function unitPriceCents(garment: string, shirtCents: number, tankCents: number): number {
  return garment === "TANK" ? tankCents : shirtCents;
}

/**
 * Sales tax applies to APPAREL only — never to the season fee, coaching, or
 * private/group lessons. 8% of the apparel subtotal, rounded to the cent.
 */
export const APPAREL_TAX_RATE = 0.08;
export function apparelTaxCents(apparelSubtotalCents: number): number {
  return Math.round(apparelSubtotalCents * APPAREL_TAX_RATE);
}

export type CartLine = { garment: Garment; size: SizeKey; quantity: number; personId?: string | null };

const MAX_QTY_PER_LINE = 20;

/**
 * Validate an untrusted cart (from the pay form) into clean lines. Drops any
 * line with an unknown garment/size or a non-positive quantity, and clamps
 * quantity to a sane ceiling. Never trusts a client-sent price. An optional
 * `allowedPersonIds` restricts the per-line player tag to the invoice's players
 * (anything else becomes null).
 */
export function normalizeCart(raw: unknown, allowedPersonIds?: string[]): CartLine[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const allow = allowedPersonIds ? new Set(allowedPersonIds) : null;
  const out: CartLine[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const g = String(rec.garment ?? "");
    const s = String(rec.size ?? "");
    const q = Math.floor(Number(rec.quantity ?? 0));
    if (!GARMENT_KEYS.has(g as Garment) || !SIZE_KEYS.has(s as SizeKey)) continue;
    if (!Number.isFinite(q) || q < 1) continue;
    const pidRaw = rec.personId == null ? null : String(rec.personId);
    const personId = pidRaw && (!allow || allow.has(pidRaw)) ? pidRaw : null;
    out.push({ garment: g as Garment, size: s as SizeKey, quantity: Math.min(q, MAX_QTY_PER_LINE), personId });
  }
  return out;
}

export function cartTotalCents(lines: CartLine[], shirtCents: number, tankCents: number): number {
  return lines.reduce((sum, l) => sum + unitPriceCents(l.garment, shirtCents, tankCents) * l.quantity, 0);
}
