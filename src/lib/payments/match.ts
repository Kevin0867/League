import "server-only";
import { prisma } from "@/lib/db";
import { apparelTotalCents } from "@/lib/payments/apparel";

// Match a Stripe charge to the fee it paid, by payer email + amount — allowing
// for the fact that ONE charge usually covers TWO things: the season fee AND
// team apparel (plus 8% apparel tax). The fee Payment row stores only the fee
// amount, so a combined charge never equals it exactly; we also accept the
// fee-plus-apparel total. Attribution then flows to the right areas on its own:
// the fee row is marked paid, and its apparel (ApparelOrderItem tied to the same
// payment) is what the Apparel-collected figure counts — so one match credits
// both the fee and the apparel.
//
// Email matches the player OR their parent/guardian (a parent almost always
// pays). The single-candidate rule is strict: if two outstanding fees could each
// explain the charge, we return null and leave it for human triage rather than
// guess wrong between two families.

/**
 * Pull the player's name out of a Stripe line-item / checkout "items" string.
 * Stripe names the item "PURE Academy — Fall 2026 season fee — Emma Williams ·
 * PURE Mesa ELE", so the player is the text after "season fee —" up to the next
 * "·", "(", ";" or end. Returns "" when there's no season-fee line to read.
 */
export function playerNameFromText(text: string): string {
  if (!text) return "";
  const m = text.match(/season fee\s*[—-]\s*([^·(;]+?)\s*(?:·|\(|;|$)/i);
  return m ? m[1].trim() : "";
}

/**
 * Find the single outstanding season fee for a player named on a charge's items.
 * Matches the person by "First … Last" (case-insensitive), then their one
 * unsettled PLAYER_FEE (as payer or as a covered player on a family invoice).
 * Strict single-match: null if the name maps to two people or two open fees, so
 * we never guess wrong. Returns the fee id AND the matched player id.
 */
export async function matchFeeByPlayerName(name: string): Promise<{ feeId: string; personId: string } | null> {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });
  const people = await prisma.person.findMany({ where: { firstName: ci(first), lastName: ci(last) }, select: { id: true } });
  if (people.length === 0) return null;
  const ids = people.map((p) => p.id);
  const fees = await prisma.payment.findMany({
    where: {
      direction: "IN",
      category: "PLAYER_FEE",
      status: { in: ["REQUESTED", "PENDING", "FAILED"] },
      OR: [{ partyId: { in: ids } }, ...ids.map((id) => ({ coveredPersonIds: { array_contains: id } }))],
    },
    select: { id: true, partyId: true, coveredPersonIds: true },
  });
  if (fees.length !== 1) return null;
  const fee = fees[0];
  const covered = Array.isArray(fee.coveredPersonIds) ? (fee.coveredPersonIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const personId = ids.find((id) => covered.includes(id)) ?? (fee.partyId && ids.includes(fee.partyId) ? fee.partyId : ids[0]);
  return { feeId: fee.id, personId };
}

/** The full amount Stripe charges for a fee payment: fee + its apparel + tax. */
export async function chargeTotalForPayment(paymentId: string, feeCents: number): Promise<number> {
  return feeCents + (await apparelTotalCents(paymentId));
}

/**
 * Find the single outstanding fee a charge paid, or null. `chargeAmountCents`
 * matches when it equals the fee alone OR the fee + apparel total.
 */
export async function matchFeeByEmailAndAmount(email: string, chargeAmountCents: number): Promise<string | null> {
  const term = email.trim();
  if (!term) return null;
  const emailEq = { equals: term, mode: "insensitive" as const };
  const candidates = await prisma.payment.findMany({
    where: {
      direction: "IN",
      status: { in: ["REQUESTED", "PENDING"] },
      OR: [
        { party: { email: emailEq } },
        { party: { email2: emailEq } },
        { party: { email3: emailEq } },
        { party: { guardian: { email: emailEq } } },
      ],
    },
    select: { id: true, amountCents: true },
  });
  const hits: string[] = [];
  for (const c of candidates) {
    const total = await chargeTotalForPayment(c.id, c.amountCents);
    if (chargeAmountCents === c.amountCents || chargeAmountCents === total) hits.push(c.id);
  }
  return hits.length === 1 ? hits[0] : null;
}
