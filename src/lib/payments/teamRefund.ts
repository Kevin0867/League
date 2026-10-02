import "server-only";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { syncRefundsForCharge } from "@/lib/payments/refunds";
import { audit } from "@/lib/audit";

// Refund a FIXED partial amount (e.g. $123.75 for 3 cancelled practices) to every
// member of a team — the money goes back to the card that paid each season fee.
// Built as plan (local, no Stripe — safe to render as a preview) + execute
// (issues the Stripe refunds and books the OUT/REFUND ledger rows). The execute
// step is idempotent per charge via a Stripe idempotency key, so a double-click
// or re-run never refunds twice.

export type MemberRefundRow = {
  personId: string;
  name: string;
  /** The season-fee payment that covers this member, if found. */
  paymentId: string | null;
  payerName: string | null;
  /** How the fee was paid, for the admin's context. */
  payNote: string;
  /** Whether we can issue a card refund for this member. */
  eligible: boolean;
  /** When not eligible, why. */
  reason: string | null;
};

export type TeamRefundPlan = {
  teamId: string;
  teamName: string;
  amountCents: number;
  rows: MemberRefundRow[];
  eligibleCount: number;
  totalCents: number;
};

async function coveringPayment(seasonId: string, personId: string) {
  // The fee covering this member — their own, or (for a minor) the guardian's.
  // A settled one-time fee OR an active/settled plan with at least one payment in.
  return prisma.payment.findFirst({
    where: {
      seasonId,
      category: "PLAYER_FEE",
      status: { in: ["PAID", "PENDING"] },
      OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, amountCents: true, status: true, installmentPlan: true, installmentsPaid: true,
      stripePaymentIntentId: true, stripeSubscriptionId: true, description: true, partyId: true, seasonId: true,
      party: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Build the per-member refund plan WITHOUT touching Stripe — safe for a preview. */
export async function planTeamRefund(teamId: string, amountCents: number): Promise<TeamRefundPlan | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, isTest: true, seasonId: true } });
  if (!team) return null;
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    select: { personId: true, person: { select: { firstName: true, lastName: true } } },
    orderBy: { person: { lastName: "asc" } },
  });

  const rows: MemberRefundRow[] = [];
  for (const m of members) {
    const name = `${m.person.firstName} ${m.person.lastName}`.trim();
    if (team.isTest) {
      rows.push({ personId: m.personId, name, paymentId: null, payerName: null, payNote: "test team", eligible: false, reason: "test team — not refunded" });
      continue;
    }
    const pay = await coveringPayment(team.seasonId, m.personId);
    if (!pay) {
      rows.push({ personId: m.personId, name, paymentId: null, payerName: null, payNote: "no paid season fee on file", eligible: false, reason: "no paid fee to refund" });
      continue;
    }
    const payerName = pay.party ? `${pay.party.firstName} ${pay.party.lastName}`.trim() : null;
    const hasStripe = !!(pay.stripePaymentIntentId || pay.stripeSubscriptionId);
    const paidInCents = pay.installmentPlan
      ? Math.round((pay.amountCents / 3) * Math.max(1, pay.installmentsPaid ?? 1)) // ~ what's been charged so far
      : pay.status === "PAID" ? pay.amountCents : 0;
    const payNote = pay.installmentPlan
      ? `3-payment plan · ${pay.installmentsPaid ?? 0}/3 paid (~$${(paidInCents / 100).toFixed(2)} in)`
      : pay.status === "PAID" ? `paid in full ($${(pay.amountCents / 100).toFixed(2)})` : `status ${pay.status.toLowerCase()}`;

    let eligible = true;
    let reason: string | null = null;
    if (!hasStripe) { eligible = false; reason = "no card charge on file (paid offline?) — refund by hand"; }
    else if (paidInCents < amountCents) { eligible = false; reason = `only ~$${(paidInCents / 100).toFixed(2)} paid so far — less than the refund`; }

    rows.push({ personId: m.personId, name, paymentId: pay.id, payerName, payNote, eligible, reason });
  }

  const eligibleCount = rows.filter((r) => r.eligible).length;
  return { teamId: team.id, teamName: team.name, amountCents, rows, eligibleCount, totalCents: eligibleCount * amountCents };
}

export type TeamRefundResult = {
  refunded: number;
  refundedCents: number;
  skipped: number;
  failed: number;
  lines: { name: string; outcome: "refunded" | "skipped" | "failed"; note: string }[];
};

/** Issue the partial refunds for the plan's eligible members. Idempotent per charge. */
export async function executeTeamRefund(opts: { teamId: string; amountCents: number; reason: string; actorId: string }): Promise<TeamRefundResult> {
  const { teamId, amountCents, reason, actorId } = opts;
  const plan = await planTeamRefund(teamId, amountCents);
  const result: TeamRefundResult = { refunded: 0, refundedCents: 0, skipped: 0, failed: 0, lines: [] };
  if (!plan) return result;
  const label = reason.trim() || "partial refund";

  for (const row of plan.rows) {
    if (!row.eligible || !row.paymentId) {
      result.skipped++;
      result.lines.push({ name: row.name, outcome: "skipped", note: row.reason ?? "not eligible" });
      continue;
    }
    const pay = await prisma.payment.findUnique({
      where: { id: row.paymentId },
      select: { id: true, partyId: true, seasonId: true, amountCents: true, status: true, description: true, stripePaymentIntentId: true, stripeSubscriptionId: true },
    });
    if (!pay) { result.skipped++; result.lines.push({ name: row.name, outcome: "skipped", note: "payment vanished" }); continue; }
    const original = { id: pay.id, partyId: pay.partyId, seasonId: pay.seasonId, amountCents: pay.amountCents, status: pay.status, description: `${pay.description ?? "season fee"} — ${label}` };

    if (!isStripeConfigured()) {
      // Dev / no keys: book a simulated OUT row so the ledger still reflects it.
      await prisma.payment.create({
        data: { direction: "OUT", partyId: pay.partyId, amountCents, method: "STRIPE", status: "PAID", category: "REFUND", seasonId: pay.seasonId, paidAt: new Date(), description: `Refund — ${label} [simulated]` },
      });
      result.refunded++; result.refundedCents += amountCents;
      result.lines.push({ name: row.name, outcome: "refunded", note: `$${(amountCents / 100).toFixed(2)} (simulated)` });
      continue;
    }

    try {
      // Find a card charge with enough still-refundable balance, then refund the
      // fixed amount against it. One-time pay → the PI's charge; plan → the first
      // paid invoice charge that can cover it.
      const chargeId = await findRefundableCharge(pay, amountCents);
      if (!chargeId) { result.skipped++; result.lines.push({ name: row.name, outcome: "skipped", note: "no charge with enough refundable balance" }); continue; }
      // Idempotency key ties the refund to this member+team+amount+charge, so a
      // re-run returns the same refund instead of issuing a second one. The
      // personId is in the key so two members who share one charge (siblings
      // billed together) each get their own refund rather than colliding.
      await stripe().refunds.create(
        { charge: chargeId, amount: amountCents, metadata: { teamId, personId: row.personId, reason: label.slice(0, 200) } },
        { idempotencyKey: `teamrefund:${teamId}:${row.personId}:${amountCents}:${chargeId}` },
      );
      const fresh = await stripe().charges.retrieve(chargeId);
      const synced = await syncRefundsForCharge(original, fresh.id, fresh.amount, fresh.amount_refunded);
      result.refunded++; result.refundedCents += amountCents;
      result.lines.push({ name: row.name, outcome: "refunded", note: `$${(amountCents / 100).toFixed(2)}${synced.created === 0 ? " (already booked)" : ""}` });
    } catch (e) {
      result.failed++;
      result.lines.push({ name: row.name, outcome: "failed", note: e instanceof Error ? e.message.slice(0, 120) : "refund failed" });
      console.error("teamRefund: refund failed for", row.name, e);
    }
  }

  await audit({
    actorId, entityType: "Team", entityId: teamId, action: "TEAM_REFUND",
    summary: `Team refund — ${label}: $${(amountCents / 100).toFixed(2)} each · ${result.refunded} refunded ($${(result.refundedCents / 100).toFixed(2)}), ${result.skipped} skipped, ${result.failed} failed`,
  });
  return result;
}

/** A card charge for this payment with at least `amountCents` still refundable. */
async function findRefundableCharge(
  pay: { stripePaymentIntentId: string | null; stripeSubscriptionId: string | null },
  amountCents: number,
): Promise<string | null> {
  const canCover = (c: { amount: number; amount_refunded: number; status: string }) =>
    c.status === "succeeded" && c.amount - (c.amount_refunded ?? 0) >= amountCents;
  if (pay.stripePaymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(pay.stripePaymentIntentId);
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    if (chargeId) {
      const charge = await stripe().charges.retrieve(chargeId);
      if (canCover(charge)) return charge.id;
    }
  }
  if (pay.stripeSubscriptionId) {
    const invoices = await stripe().invoices.list({ subscription: pay.stripeSubscriptionId, limit: 100 });
    for (const inv of invoices.data) {
      const ref = (inv as unknown as { charge?: string | { id?: string } | null }).charge;
      const chargeId = typeof ref === "string" ? ref : ref?.id ?? null;
      if (!chargeId) continue;
      const charge = await stripe().charges.retrieve(chargeId);
      if (canCover(charge)) return charge.id;
    }
  }
  return null;
}
