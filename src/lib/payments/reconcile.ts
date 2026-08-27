import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";
import { syncRefundsForCharge } from "@/lib/payments/refunds";

// Reconcile local Payment rows against Stripe — the safety net for payments that
// were completed in Stripe but never marked PAID here (a missed / mis-signed
// webhook, an expired-then-paid session, etc.). "Collected" revenue sums PAID
// rows, so an unrecorded payment silently underreports. This asks Stripe the
// true status of every not-yet-PAID Stripe payment and records what it finds.
//
// Read-mostly and idempotent: it only ever moves a row toward what Stripe says
// (→ PAID, or advances installment counts). It never marks anything paid that
// Stripe doesn't confirm, and it re-runs safely.

export type ReconcileResult = {
  scanned: number;
  updated: number;
  nowPaid: number;
  recoveredCents: number;
  refundsRecorded: number;
  refundedCents: number;
  /** Charges found in Stripe with no local row at all, imported as PAID. */
  imported: number;
  importedCents: number;
  /** Charges read directly from Stripe during the outside-in pass. */
  chargesScanned: number;
  /** Imported charges we couldn't attribute to a known person (need a name). */
  importedUnattributed: number;
  errors: number;
  details: Array<{ paymentId: string; note: string; amountCents: number; nowPaid: boolean }>;
};

type PaymentRow = {
  id: string;
  amountCents: number;
  status: string;
  paidAt: Date | null;
  installmentPlan: boolean;
  installmentsPaid: number;
  installmentsTotal: number | null;
  stripeCheckoutId: string | null;
  stripePaymentIntentId: string | null;
  stripeSubscriptionId: string | null;
};

const paidAtFromUnix = (secs: number | null | undefined): Date | null =>
  secs ? new Date(secs * 1000) : null;

// The IMPORT FLOOR: the earliest a charge may be *imported* as a new row. This
// exists so reconciliation can never again pull the historical Stripe backlog
// into the books (which double-counts payments already recorded from the old
// system). It is a FIXED instant — the day this guard went live — NOT "start of
// today recomputed each run", so the nightly cron with a rolling scan window
// still catches yesterday's charges without ever reaching before the floor.
// Overridable via env if the floor ever needs to move.
const IMPORT_FLOOR_ISO = process.env.RECONCILE_IMPORT_FLOOR || "2026-08-27T00:00:00-07:00";
export const IMPORT_FLOOR_UNIX = Math.floor(new Date(IMPORT_FLOOR_ISO).getTime() / 1000);

/**
 * Undo the historical over-import: remove the auto-imported PAID rows dated
 * BEFORE the import floor (the backlog that inflated revenue). Today-and-later
 * imports are kept. Identified via the audit trail we write on every import, so
 * it only ever touches rows this tool created. Safe to re-run.
 */
export async function undoStripeImport(): Promise<{ removed: number; removedCents: number }> {
  const logs = await prisma.auditLog.findMany({
    where: { action: "IMPORTED", entityType: "Payment" },
    select: { entityId: true },
  });
  const ids = [...new Set(logs.map((l) => l.entityId).filter(Boolean))];
  if (!ids.length) return { removed: 0, removedCents: 0 };

  // Only remove rows this tool imported (method/status/direction guardrails) that
  // are dated before the floor — i.e. the pre-today backlog, not today's real ones.
  const rows = await prisma.payment.findMany({
    where: {
      id: { in: ids },
      direction: "IN",
      method: "STRIPE",
      status: "PAID",
      paidAt: { lt: new Date(IMPORT_FLOOR_UNIX * 1000) },
    },
    select: { id: true, amountCents: true },
  });
  const removedCents = rows.reduce((s, r) => s + r.amountCents, 0);
  if (rows.length) await prisma.payment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await audit({
    entityType: "Payment",
    entityId: "reconcile",
    action: "IMPORT_REVERTED",
    summary: `Removed ${rows.length} pre-floor auto-imported Stripe rows ($${(removedCents / 100).toFixed(2)})`,
  });
  return { removed: rows.length, removedCents };
}

/** Inspect one payment against Stripe and update it if Stripe shows more than we have. */
async function reconcileOne(
  p: PaymentRow,
): Promise<{ updated: boolean; nowPaid: boolean; recoveredCents: number; note: string }> {
  const client = stripe();

  // Pull the checkout session when we have its id — it tells us the mode
  // (one-time vs subscription), the payment status, and the linked objects.
  let session: Stripe.Checkout.Session | null = null;
  if (p.stripeCheckoutId) {
    try {
      session = await client.checkout.sessions.retrieve(p.stripeCheckoutId);
    } catch {
      session = null; // session may have aged out of Stripe; fall through to other keys
    }
  }

  const subId =
    p.stripeSubscriptionId ??
    (session?.mode === "subscription" ? (session.subscription as string | null) : null);

  // ---- Installment plan (Stripe subscription) ----
  if (p.installmentPlan || session?.mode === "subscription" || subId) {
    if (!subId) return { updated: false, nowPaid: false, recoveredCents: 0, note: "no subscription linked" };
    const invoices = await client.invoices.list({ subscription: subId, limit: 100 });
    const paidInvoices = invoices.data.filter((i) => i.status === "paid");
    const paidCount = paidInvoices.length;
    const total = p.installmentsTotal ?? 3;
    const done = total > 0 && paidCount >= total;
    const wasPaid = p.status === "PAID";
    const changed = paidCount !== p.installmentsPaid || (done && !wasPaid) || (subId !== p.stripeSubscriptionId);
    if (!changed) return { updated: false, nowPaid: false, recoveredCents: 0, note: "in sync" };

    const lastPaidAt = paidAtFromUnix(paidInvoices[paidInvoices.length - 1]?.status_transitions?.paid_at ?? null);
    await prisma.payment.update({
      where: { id: p.id },
      data: {
        installmentsPaid: paidCount,
        stripeSubscriptionId: subId,
        ...(done ? { status: "PAID", paidAt: p.paidAt ?? lastPaidAt ?? new Date() } : {}),
      },
    });
    await audit({
      entityType: "Payment",
      entityId: p.id,
      action: "RECONCILED",
      summary: `Reconciled with Stripe — installments ${paidCount}/${total}${done ? " (paid in full)" : ""}`,
    });
    return {
      updated: true,
      nowPaid: done && !wasPaid,
      recoveredCents: done && !wasPaid ? p.amountCents : 0,
      note: `installments ${paidCount}/${total}`,
    };
  }

  // ---- One-time checkout ----
  if (session && session.payment_status === "paid" && p.status !== "PAID") {
    const piId = (session.payment_intent as string | null) ?? p.stripePaymentIntentId;
    let paidAt: Date | null = null;
    if (piId) {
      try {
        const pi = await client.paymentIntents.retrieve(piId);
        paidAt = paidAtFromUnix(pi.created);
      } catch {
        /* keep paidAt null → falls back to now */
      }
    }
    await prisma.payment.update({
      where: { id: p.id },
      data: { status: "PAID", paidAt: p.paidAt ?? paidAt ?? new Date(), stripePaymentIntentId: piId ?? undefined },
    });
    await audit({ entityType: "Payment", entityId: p.id, action: "RECONCILED", summary: "Reconciled with Stripe — checkout paid" });
    return { updated: true, nowPaid: true, recoveredCents: p.amountCents, note: "checkout paid" };
  }

  // ---- Fallback: a stored payment intent that succeeded ----
  if (!session && p.stripePaymentIntentId && p.status !== "PAID") {
    const pi = await client.paymentIntents.retrieve(p.stripePaymentIntentId);
    if (pi.status === "succeeded") {
      await prisma.payment.update({
        where: { id: p.id },
        data: { status: "PAID", paidAt: p.paidAt ?? paidAtFromUnix(pi.created) ?? new Date() },
      });
      await audit({ entityType: "Payment", entityId: p.id, action: "RECONCILED", summary: "Reconciled with Stripe — payment intent succeeded" });
      return { updated: true, nowPaid: true, recoveredCents: p.amountCents, note: "payment intent succeeded" };
    }
  }

  return { updated: false, nowPaid: false, recoveredCents: 0, note: "no change (Stripe not paid)" };
}

/**
 * The OUTSIDE-IN pass. The inside-out reconcile above can only fix rows we
 * already have; it is blind to a Stripe charge that never created a row here
 * (paid via a Stripe Payment Link or dashboard invoice, or charged during a
 * window when our webhook pointed at the wrong domain). This walks Stripe's
 * charges directly and, for each successful one:
 *   • matches it to a local Payment (by the paymentId we stamp on the intent,
 *     or by a stored intent id) and marks that row PAID if it wasn't, else
 *   • imports it as a new PAID row so it still counts toward Collected.
 *
 * Idempotent: a charge already represented by any local row with that intent id
 * is skipped, so re-runs never double-count. Attribution is best-effort — we
 * match the payer to a Person by email when we can.
 */
async function reconcileFromStripe(res: ReconcileResult, sinceUnix: number, floorUnix: number, activeSeasonId: string | null): Promise<void> {
  const client = stripe();
  const PAGE_CAP = 25; // ≤ 2,500 charges per run — a hard stop against runaways.

  let startingAfter: string | undefined;
  for (let page = 0; page < PAGE_CAP; page++) {
    const batch: Stripe.Response<Stripe.ApiList<Stripe.Charge>> = await client.charges.list({
      created: { gte: sinceUnix },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.payment_intent"],
    });

    for (const charge of batch.data) {
      res.chargesScanned++;
      // Only real money in: a succeeded, captured charge.
      if (charge.status !== "succeeded" || !charge.paid) continue;

      try {
        const pi = (typeof charge.payment_intent === "object" ? charge.payment_intent : null) as Stripe.PaymentIntent | null;
        const piId = pi?.id ?? (typeof charge.payment_intent === "string" ? charge.payment_intent : null);
        const hintedPaymentId =
          (charge.metadata?.paymentId as string | undefined) ?? (pi?.metadata?.paymentId as string | undefined) ?? null;

        // ---- Try to match an existing local row ----
        let matched = hintedPaymentId
          ? await prisma.payment.findUnique({ where: { id: hintedPaymentId } })
          : null;
        if (!matched && piId) {
          matched = await prisma.payment.findFirst({ where: { stripePaymentIntentId: piId } });
        }
        // Subscription/installment charges: match the plan row by its subscription.
        if (!matched && charge.invoice) {
          try {
            const inv = await client.invoices.retrieve(typeof charge.invoice === "string" ? charge.invoice : charge.invoice.id);
            const sub = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null;
            if (sub) matched = await prisma.payment.findFirst({ where: { stripeSubscriptionId: sub } });
          } catch { /* fall through to import */ }
        }
        // Payment-Link / dashboard-invoice charges carry no app metadata, so the
        // fee request they paid can't be found by id. Fall back to payer email +
        // exact amount: if EXACTLY ONE outstanding request for that person has
        // that exact amount, this charge paid it. The single-candidate rule keeps
        // us from ever guessing wrong between two similar requests.
        if (!matched) {
          const email = charge.billing_details?.email ?? charge.receipt_email ?? pi?.receipt_email ?? null;
          if (email) {
            const cands = await prisma.payment.findMany({
              where: {
                direction: "IN",
                status: { in: ["REQUESTED", "PENDING"] },
                amountCents: charge.amount,
                party: { email: { equals: email, mode: "insensitive" } },
              },
              take: 2,
            });
            if (cands.length === 1) matched = cands[0];
          }
        }

        if (matched) {
          if (matched.direction !== "IN") continue; // never touch payouts/refunds
          // Ensure the intent id is stored for future refund reconciliation — but
          // not on installment plans, which track a subscription across many
          // intents (overwriting would confuse the refund pass).
          const needsPi = !!piId && !matched.installmentPlan && matched.stripePaymentIntentId !== piId;
          // A one-time row Stripe says is paid but we don't: record it. Leave
          // installment plans to the inside-out pass (it counts invoices).
          const shouldPay = matched.status !== "PAID" && !matched.installmentPlan;
          if (shouldPay || needsPi) {
            await prisma.payment.update({
              where: { id: matched.id },
              data: {
                ...(shouldPay ? { status: "PAID", paidAt: matched.paidAt ?? paidAtFromUnix(charge.created) ?? new Date() } : {}),
                ...(needsPi ? { stripePaymentIntentId: piId! } : {}),
              },
            });
            if (shouldPay) {
              await audit({ entityType: "Payment", entityId: matched.id, action: "RECONCILED", summary: "Reconciled with Stripe — charge found (outside-in)" });
              res.updated++;
              res.nowPaid++;
              res.recoveredCents += matched.amountCents;
              res.details.push({ paymentId: matched.id, note: "charge found in Stripe", amountCents: matched.amountCents, nowPaid: true });
            }
          }
          continue;
        }

        // ---- No local row at all: import the charge as a PAID record ----
        // Floor guard: NEVER import a charge dated before the import floor. This
        // is what keeps the historical backlog (already in the books from the old
        // system) out — only today-and-forward orphans are imported.
        if (charge.created < floorUnix) continue;
        // Idempotency guard: never import a charge whose intent we already hold.
        if (piId) {
          const existing = await prisma.payment.findFirst({ where: { stripePaymentIntentId: piId }, select: { id: true } });
          if (existing) continue;
        }

        const email =
          charge.billing_details?.email ??
          charge.receipt_email ??
          (pi?.receipt_email ?? null);
        const person = email
          ? await prisma.person.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })
          : null;

        const created = await prisma.payment.create({
          data: {
            direction: "IN",
            method: "STRIPE",
            status: "PAID",
            // Tag imports distinctly so they surface for triage on Payments
            // (attach to a family / set the real category). A category stamped on
            // the charge in Stripe still wins.
            category: (charge.metadata?.category as string | undefined) ?? "STRIPE_IMPORT",
            amountCents: charge.amount,
            partyId: person?.id ?? null,
            seasonId: activeSeasonId,
            stripePaymentIntentId: piId ?? undefined,
            description: (charge.description ?? "Imported from Stripe") + (person ? "" : email ? ` · ${email}` : ""),
            paidAt: paidAtFromUnix(charge.created) ?? new Date(),
          },
        });
        await audit({ entityType: "Payment", entityId: created.id, action: "IMPORTED", summary: `Imported paid charge from Stripe — ${(charge.amount / 100).toFixed(2)}${email ? ` (${email})` : ""}${person ? "" : " · unattributed"}` });
        res.imported++;
        res.importedCents += charge.amount;
        if (!person) res.importedUnattributed++;
        res.details.push({ paymentId: created.id, note: person ? "imported from Stripe" : "imported (no matching person)", amountCents: charge.amount, nowPaid: true });
      } catch (e) {
        res.errors++;
        console.error(`outside-in reconcile failed for charge ${charge.id}`, e);
      }
    }

    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
  }
}

/**
 * Reconcile every inbound Stripe payment that isn't already recorded as PAID.
 * Returns a summary of what changed. Safe to run repeatedly.
 */
export async function reconcileStripePayments(opts?: { sinceDays?: number; limit?: number }): Promise<ReconcileResult> {
  const res: ReconcileResult = { scanned: 0, updated: 0, nowPaid: 0, recoveredCents: 0, refundsRecorded: 0, refundedCents: 0, imported: 0, importedCents: 0, chargesScanned: 0, importedUnattributed: 0, errors: 0, details: [] };
  if (!isStripeConfigured()) return res;

  // TWO windows, deliberately different:
  //  • MATCHING window (long, e.g. a year): used to reconcile EXISTING request
  //    rows against Stripe and mark them PAID. This is always safe — it only
  //    corrects the status of a row we already have, it never creates money —
  //    so it must reach back over the whole season, or paid fees stay stuck in
  //    "Requested/Pending" and Collected reads low.
  //  • IMPORT floor (today): governs ONLY the creation of brand-new rows for
  //    orphan charges, so the historical backlog is never re-imported (which
  //    is what previously inflated revenue).
  const nowUnix = Math.floor(Date.now() / 1000);
  const matchSinceUnix = nowUnix - (opts?.sinceDays ?? 365) * 86400;
  const since = new Date(matchSinceUnix * 1000);
  const candidates = (await prisma.payment.findMany({
    where: {
      direction: "IN",
      method: "STRIPE",
      status: { in: ["REQUESTED", "PENDING", "FAILED"] },
      createdAt: { gte: since },
      OR: [
        { stripeCheckoutId: { not: null } },
        { stripeSubscriptionId: { not: null } },
        { stripePaymentIntentId: { not: null } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 1000,
    select: {
      id: true, amountCents: true, status: true, paidAt: true,
      installmentPlan: true, installmentsPaid: true, installmentsTotal: true,
      stripeCheckoutId: true, stripePaymentIntentId: true, stripeSubscriptionId: true,
    },
  })) as PaymentRow[];

  for (const p of candidates) {
    res.scanned++;
    try {
      const r = await reconcileOne(p);
      if (r.updated) {
        res.updated++;
        if (r.nowPaid) res.nowPaid++;
        res.recoveredCents += r.recoveredCents;
        res.details.push({ paymentId: p.id, note: r.note, amountCents: p.amountCents, nowPaid: r.nowPaid });
      }
    } catch (e) {
      res.errors++;
      console.error(`reconcile failed for payment ${p.id}`, e);
    }
  }

  // Outside-in pass: walk Stripe's own charge list and record anything that
  // never made it into our books (external Payment Links, dashboard invoices,
  // or charges taken while the webhook was mis-pointed). This is what catches
  // "Stripe shows more transactions than the app does".
  const activeSeason =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } })) ??
    (await prisma.season.findFirst({ orderBy: { startDate: "desc" }, select: { id: true } }));
  try {
    await reconcileFromStripe(res, matchSinceUnix, IMPORT_FLOOR_UNIX, activeSeason?.id ?? null);
  } catch (e) {
    res.errors++;
    console.error("outside-in reconcile pass failed", e);
  }

  // Second pass: catch refunds issued directly in Stripe (no app record). Look at
  // PAID inbound charges and book any refund we haven't recorded yet.
  const paidCharges = await prisma.payment.findMany({
    where: {
      direction: "IN",
      method: "STRIPE",
      status: "PAID",
      createdAt: { gte: since },
      stripePaymentIntentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 1000,
    select: { id: true, partyId: true, seasonId: true, amountCents: true, status: true, description: true, stripePaymentIntentId: true },
  });
  for (const p of paidCharges) {
    try {
      const pi = await stripe().paymentIntents.retrieve(p.stripePaymentIntentId!, { expand: ["latest_charge"] });
      const charge = pi.latest_charge as { id: string; amount: number; amount_refunded: number } | null;
      if (charge && charge.amount_refunded > 0) {
        const r = await syncRefundsForCharge(
          { id: p.id, partyId: p.partyId, seasonId: p.seasonId, amountCents: p.amountCents, status: p.status, description: p.description },
          charge.id, charge.amount, charge.amount_refunded,
        );
        if (r.created > 0) {
          res.refundsRecorded += r.created;
          res.refundedCents += r.createdCents;
        }
      }
    } catch (e) {
      res.errors++;
      console.error(`refund reconcile failed for payment ${p.id}`, e);
    }
  }

  return res;
}
