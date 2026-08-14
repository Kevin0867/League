import "server-only";
import { prisma } from "@/lib/db";

// Per-player season fee (§8). Each player gets their OWN season-fee invoice, so
// every payment maps to exactly one player → one team, giving clean per-team
// revenue and never bundling a non-placed sibling onto a parent's charge. The
// invoice's payer (partyId) is the paying adult — a minor's guardian, or the
// player themselves — so a guardian with two players receives two invoices, one
// per child. coveredPersonIds always lists the single player the invoice is for.

const OPEN_STATUSES = ["REQUESTED", "PENDING", "PAID"];

/** The player personIds a payment covers — legacy single-player rows cover just their partyId. */
export function coveredIds(p: { coveredPersonIds: unknown; partyId: string | null }): string[] {
  const v = p.coveredPersonIds;
  if (Array.isArray(v)) return v.map(String);
  return p.partyId ? [p.partyId] : [];
}

export type AccrualResult = {
  paymentId: string;
  payerId: string;
  amountCents: number;
  coveredCount: number;
  created: boolean;
};

/**
 * Ensure a season-fee invoice exists for ONE player, billed to their paying
 * adult. If the player already has an open or paid fee this season, returns that
 * existing invoice (created: false) so callers can re-send its pay link without
 * double-billing; otherwise creates a fresh single-player invoice.
 */
export async function accruePlayerSeasonFee(opts: {
  playerId: string;
  seasonId: string;
  feeCents: number;
  seasonName: string;
}): Promise<AccrualResult> {
  const { playerId, seasonId, feeCents, seasonName } = opts;

  const player = await prisma.person.findUnique({ where: { id: playerId }, select: { guardianId: true } });
  const payerId = player?.guardianId ?? playerId;

  // Already invoiced for this player this season (any payer) → reuse it, so
  // Launch/Send-all and Request-fee never create a second charge for one player.
  const openForSeason = await prisma.payment.findMany({
    where: { seasonId, category: "PLAYER_FEE", status: { in: OPEN_STATUSES } },
    select: { id: true, partyId: true, coveredPersonIds: true, amountCents: true },
  });
  const existing = openForSeason.find((p) => coveredIds(p).includes(playerId));
  if (existing) {
    return { paymentId: existing.id, payerId: existing.partyId ?? payerId, amountCents: existing.amountCents, coveredCount: 1, created: false };
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
      description: `${seasonName} season fee`,
    },
  });
  return { paymentId: created.id, payerId, amountCents: feeCents, coveredCount: 1, created: true };
}
