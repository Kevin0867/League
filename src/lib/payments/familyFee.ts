import "server-only";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/stripe";

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

/**
 * A season-fee description that names the player and (when placed) their team,
 * e.g. "Fall 2026 season fee — Ethan Berk · HS Elite". This is what a parent sees
 * on the invoice, the pay page, and every request/reminder email, so two invoices
 * for two children on two teams are never mistaken for each other.
 */
export function seasonFeeDescription(seasonName: string, playerName?: string | null, teamName?: string | null): string {
  const who = playerName ? ` — ${playerName}` : "";
  const where = playerName && teamName ? ` · ${teamName}` : "";
  return `${seasonName} season fee${who}${where}`;
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
 *
 * The invoice description names the player and their current team so a guardian
 * paying for several children can tell each invoice apart. On reuse we refresh
 * that description, so a player who has since been moved to a different team
 * shows the right team on their next reminder.
 */
export async function accruePlayerSeasonFee(opts: {
  playerId: string;
  seasonId: string;
  feeCents: number;
  seasonName: string;
}): Promise<AccrualResult> {
  const { playerId, seasonId, feeCents, seasonName } = opts;

  const player = await prisma.person.findUnique({
    where: { id: playerId },
    select: { guardianId: true, firstName: true, lastName: true },
  });
  const payerId = player?.guardianId ?? playerId;
  const playerName = player ? `${player.firstName} ${player.lastName}`.trim() : null;

  // The player's team in this season (if placed) — named on the invoice.
  const membership = await prisma.teamMember.findFirst({
    where: { personId: playerId, team: { seasonId } },
    select: { team: { select: { name: true } } },
  });
  const description = seasonFeeDescription(seasonName, playerName, membership?.team?.name ?? null);

  // Already invoiced for this player this season (any payer) → reuse it, so
  // Launch/Send-all and Request-fee never create a second charge for one player.
  const openForSeason = await prisma.payment.findMany({
    where: { seasonId, category: "PLAYER_FEE", status: { in: OPEN_STATUSES } },
    select: { id: true, partyId: true, coveredPersonIds: true, amountCents: true, description: true },
  });
  const existing = openForSeason.find((p) => coveredIds(p).includes(playerId));
  if (existing) {
    // Keep the description current (e.g. after a team move) without re-billing.
    if (existing.description !== description) {
      await prisma.payment.update({ where: { id: existing.id }, data: { description } }).catch(() => {});
    }
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
      description,
    },
  });
  return { paymentId: created.id, payerId, amountCents: feeCents, coveredCount: 1, created: true };
}

export type SplitResult =
  | { ok: true; created: number; players: number }
  | { ok: false; reason: "notfound" | "single" | "inflight" };

/**
 * Split a consolidated season-fee invoice (one payment covering several players —
 * a legacy "one total per family" charge) into a separate per-player invoice for
 * each covered player, so a father and son on two different teams each get their
 * own invoice, pay link, and clean per-team revenue.
 *
 * Safe by construction: only a REQUESTED invoice (no money moved yet, no apparel
 * bundled at checkout) is split. A PENDING or PAID invoice is left untouched and
 * reported back as "inflight" — that has to be refunded before it can be split.
 * The consolidated row is deleted FIRST so the per-player accrual below creates
 * fresh invoices instead of finding and reusing the very row we're replacing.
 */
export async function splitFamilyFee(opts: {
  playerId: string;
  seasonId: string;
  feeCents: number;
  seasonName: string;
}): Promise<SplitResult> {
  const { playerId, seasonId, feeCents, seasonName } = opts;
  const open = await prisma.payment.findMany({
    where: { seasonId, category: "PLAYER_FEE", status: { in: OPEN_STATUSES } },
    select: { id: true, coveredPersonIds: true, partyId: true, status: true },
  });
  const inv = open.find((p) => coveredIds(p).includes(playerId));
  if (!inv) return { ok: false, reason: "notfound" };

  const covered = coveredIds(inv);
  if (covered.length <= 1) return { ok: false, reason: "single" };
  if (inv.status !== "REQUESTED") return { ok: false, reason: "inflight" };

  await prisma.payment.delete({ where: { id: inv.id } });
  let created = 0;
  for (const pid of covered) {
    const res = await accruePlayerSeasonFee({ playerId: pid, seasonId, feeCents, seasonName });
    if (res.created) created++;
  }
  return { ok: true, created, players: covered.length };
}

/**
 * For a placed player, ensure the season fee is invoiced and return the secure
 * pay link + fee amount, so placement / welcome / launch emails can carry a
 * "Choose apparel & pay" button. Idempotent — reuses the existing invoice.
 * Returns null when the player's fee is waived (nothing to collect).
 */
export async function placementPayLink(
  personId: string,
  seasonId: string,
): Promise<{ payUrl: string; feeCents: number } | null> {
  const reg = await prisma.registration.findFirst({ where: { personId, seasonId }, select: { feeWaived: true } });
  if (reg?.feeWaived) return null;
  const [rate, season] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { name: true } }),
  ]);
  const feeCents = rate?.seasonFeeCents ?? 49500;
  const res = await accruePlayerSeasonFee({ playerId: personId, seasonId, feeCents, seasonName: season?.name ?? "Season" });
  if (!res?.paymentId) return null;
  return { payUrl: `${appUrl()}/pay/${res.paymentId}`, feeCents };
}
