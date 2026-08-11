import "server-only";
import { prisma } from "@/lib/db";

// Consolidated family season fee (§8). Every player's season fee rolls up to the
// paying adult (a minor's guardian, or the player themselves) as ONE invoice for
// the household. New enrollments accrue onto the family's still-open invoice so
// the family sees a single total; once that invoice enters checkout (PENDING) or
// is PAID, a further enrollment starts a fresh invoice.

const OPEN_STATUSES = ["REQUESTED", "PENDING", "PAID"];

/** The player personIds a payment covers — legacy single-player rows cover just their partyId. */
export function coveredIds(p: { coveredPersonIds: unknown; partyId: string | null }): string[] {
  const v = p.coveredPersonIds;
  if (Array.isArray(v)) return v.map(String);
  return p.partyId ? [p.partyId] : [];
}

function familyDescription(seasonName: string, count: number): string {
  return count > 1 ? `${seasonName} season fees (${count} enrollments)` : `${seasonName} season fee`;
}

export type AccrualResult = {
  paymentId: string;
  payerId: string;
  amountCents: number;
  coveredCount: number;
  created: boolean;
};

/**
 * Bill one player's season fee to their household invoice. Returns the affected
 * invoice, or null if the player is already covered by an existing fee this
 * season (so callers don't double-bill or re-email).
 */
export async function accrueFamilySeasonFee(opts: {
  playerId: string;
  seasonId: string;
  feeCents: number;
  seasonName: string;
}): Promise<AccrualResult | null> {
  const { playerId, seasonId, feeCents, seasonName } = opts;

  const player = await prisma.person.findUnique({ where: { id: playerId }, select: { guardianId: true } });
  const payerId = player?.guardianId ?? playerId;

  const payerPayments = await prisma.payment.findMany({
    where: { partyId: payerId, seasonId, category: "PLAYER_FEE", status: { in: OPEN_STATUSES } },
  });

  // Already billed somewhere for this season → skip.
  const alreadyCovered = new Set(payerPayments.flatMap((p) => coveredIds(p)));
  if (alreadyCovered.has(playerId)) return null;

  // Accrue onto a still-open (not yet checked-out) invoice if one exists.
  const open = payerPayments.find((p) => p.status === "REQUESTED");
  if (open) {
    const ids = [...coveredIds(open), playerId];
    const amountCents = open.amountCents + feeCents;
    await prisma.payment.update({
      where: { id: open.id },
      data: { amountCents, coveredPersonIds: ids, description: familyDescription(seasonName, ids.length) },
    });
    return { paymentId: open.id, payerId, amountCents, coveredCount: ids.length, created: false };
  }

  const created = await prisma.payment.create({
    data: {
      direction: "IN",
      partyId: payerId,
      amountCents: feeCents,
      method: "STRIPE",
      status: "REQUESTED",
      category: "PLAYER_FEE",
      seasonId,
      coveredPersonIds: [playerId],
      description: familyDescription(seasonName, 1),
    },
  });
  return { paymentId: created.id, payerId, amountCents: feeCents, coveredCount: 1, created: true };
}
