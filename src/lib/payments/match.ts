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
