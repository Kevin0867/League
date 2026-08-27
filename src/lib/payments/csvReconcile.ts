import "server-only";
import { prisma } from "@/lib/db";
import { parseCsv } from "@/lib/domain/enrollmentImport";
import { audit } from "@/lib/audit";

// EXACT reconciliation from a Stripe "unified payments" CSV export. This is the
// authoritative path: the file is the same list of charges the admin sees in
// Stripe, and each app-created charge carries our own Payment id in the
// `paymentId (metadata)` column — so we can match a charge to the exact fee
// request (and therefore the exact person/family) with zero guessing. Rows
// without that id fall back to the Customer Email.
//
// For every Paid row we guarantee one correctly-attributed PAID record:
//   1. paymentId (metadata) → our Payment.id → mark that row PAID (its party is
//      already the right family).
//   2. else Customer Email → the person → their outstanding fee → mark PAID;
//      if they have none outstanding, create a PAID record attributed to them.
//   3. else (unknown email) → create a PAID record flagged for manual attach.
// Idempotent: every processed charge stores its Stripe charge id, so re-running
// the same (or an overlapping) export never double-counts.

export type CsvReconcileResult = {
  rows: number;
  paidRows: number;
  markedById: number;
  markedByEmail: number;
  /** Person found with no fee on file at all → recorded against them (real money that was missing). */
  createdAttributed: number;
  /** Person found who already has a fee on file (webhook got it) — skipped, no double-count. */
  noOutstanding: number;
  /** No person matched the payer email. */
  noPersonMatch: number;
  alreadyDone: number;
  skippedFailed: number;
  errors: number;
  appliedCents: number; // total $ newly marked paid
  unmatched: { email: string; amountCents: number; chargeId: string }[];
  problems: { chargeId: string; email: string; note: string }[];
};

const cents = (s: string): number => {
  const n = parseFloat((s ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
};

function colFinder(headers: string[]) {
  const norm = (h: string) => h.toLowerCase().trim();
  const H = headers.map(norm);
  return (pred: (h: string) => boolean) => H.findIndex(pred);
}

export async function reconcileFromCsv(text: string, seasonId: string | null): Promise<CsvReconcileResult> {
  const res: CsvReconcileResult = {
    rows: 0, paidRows: 0, markedById: 0, markedByEmail: 0, createdAttributed: 0, noOutstanding: 0, noPersonMatch: 0,
    alreadyDone: 0, skippedFailed: 0, errors: 0, appliedCents: 0, unmatched: [], problems: [],
  };

  const table = parseCsv(text);
  if (table.length < 2) return res;
  const headers = table[0];
  const find = colFinder(headers);

  const idxId = find((h) => h === "id");
  const idxAmount = find((h) => h === "amount");
  const idxStatus = find((h) => h === "status");
  const idxEmail = find((h) => h === "customer email");
  const idxPaymentId = find((h) => h.includes("paymentid"));
  const idxCreated = find((h) => h.includes("created") && h.includes("date"));

  const get = (row: string[], i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (row.every((c) => !c || !c.trim())) continue;
    res.rows++;

    const status = get(row, idxStatus).toLowerCase();
    const chargeId = get(row, idxId);
    const email = get(row, idxEmail).toLowerCase();
    const pid = get(row, idxPaymentId);
    const amountCents = cents(get(row, idxAmount));
    const createdRaw = get(row, idxCreated);
    let paidAt = new Date();
    if (createdRaw) {
      const d = new Date(createdRaw.replace(" ", "T") + "Z");
      if (!isNaN(d.getTime())) paidAt = d;
    }

    // Only settled money. Failed/blocked rows never create or clear anything.
    if (status !== "paid" && status !== "succeeded") { res.skippedFailed++; continue; }
    res.paidRows++;

    try {
      // Idempotency: if we've already recorded this exact Stripe charge, done.
      if (chargeId) {
        const seen = await prisma.payment.findFirst({ where: { stripePaymentIntentId: chargeId } });
        if (seen) {
          if (seen.status !== "PAID" && !seen.installmentPlan) {
            await prisma.payment.update({ where: { id: seen.id }, data: { status: "PAID", paidAt: seen.paidAt ?? paidAt } });
            res.markedById++; res.appliedCents += seen.amountCents;
          } else {
            res.alreadyDone++;
          }
          continue;
        }
      }

      // 1) EXACT: match our own Payment id from the charge metadata.
      if (pid) {
        const pay = await prisma.payment.findUnique({ where: { id: pid } });
        if (pay && pay.direction === "IN") {
          if (pay.status === "PAID") {
            if (pay.stripePaymentIntentId !== chargeId && chargeId) {
              await prisma.payment.update({ where: { id: pay.id }, data: { stripePaymentIntentId: chargeId } });
            }
            res.alreadyDone++;
          } else if (pay.installmentPlan) {
            // An installment plan row: leave the plan accounting alone, just link it.
            if (chargeId) await prisma.payment.update({ where: { id: pay.id }, data: { stripePaymentIntentId: chargeId } });
            res.alreadyDone++;
          } else {
            await prisma.payment.update({ where: { id: pay.id }, data: { status: "PAID", paidAt: pay.paidAt ?? paidAt, stripePaymentIntentId: chargeId || pay.stripePaymentIntentId } });
            res.markedById++; res.appliedCents += pay.amountCents;
          }
          continue;
        }
        // pid present but not found here — fall through to email matching.
      }

      // 2) Match by payer email → their outstanding fee, else create attributed.
      const person = email
        ? await prisma.person.findFirst({
            where: { OR: [{ email: { equals: email, mode: "insensitive" } }, { email2: { equals: email, mode: "insensitive" } }, { email3: { equals: email, mode: "insensitive" } }] },
            select: { id: true },
          })
        : null;

      if (person) {
        const outstanding = await prisma.payment.findMany({
          where: { partyId: person.id, direction: "IN", status: { in: ["REQUESTED", "PENDING"] } },
          orderBy: { createdAt: "desc" },
        });
        const pick =
          outstanding.find((p) => p.amountCents === amountCents) ??
          outstanding.find((p) => p.category === "PLAYER_FEE") ??
          outstanding[0];
        if (pick && !pick.installmentPlan) {
          await prisma.payment.update({ where: { id: pick.id }, data: { status: "PAID", paidAt: pick.paidAt ?? paidAt, stripePaymentIntentId: chargeId || pick.stripePaymentIntentId } });
          res.markedByEmail++; res.appliedCents += pick.amountCents;
          continue;
        }
        // No outstanding fee. Do they already have ANY fee on file (paid by the
        // webhook, or requested)? If so, this charge is already represented —
        // skip it, so we never double-count a webhook-recorded fee.
        const anyFee = await prisma.payment.findFirst({
          where: { partyId: person.id, direction: "IN", category: "PLAYER_FEE" },
          select: { id: true },
        });
        if (anyFee) {
          res.noOutstanding++;
          continue;
        }
        // They have NO fee record at all, yet they paid — this is real money that
        // isn't on the books anywhere. Record it against them so Collected is
        // complete. (Amount is the full charge; apparel can't be split out here.)
        await prisma.payment.create({
          data: {
            direction: "IN", method: "STRIPE", status: "PAID", category: "PLAYER_FEE",
            amountCents, partyId: person.id, seasonId,
            stripePaymentIntentId: chargeId || undefined,
            description: "Recorded from Stripe CSV (no fee request on file)", paidAt,
          },
        });
        res.createdAttributed++; res.appliedCents += amountCents;
        continue;
      }

      // 3) No person matched the payer email. Record it so the money counts, but
      // tag it STRIPE_IMPORT and leave it unattributed so it shows in the
      // "Imported — needs filing" card for you to attach to the right family.
      await prisma.payment.create({
        data: {
          direction: "IN", method: "STRIPE", status: "PAID", category: "STRIPE_IMPORT",
          amountCents, partyId: null, seasonId,
          stripePaymentIntentId: chargeId || undefined,
          description: `Stripe CSV — unmatched payer${email ? ` · ${email}` : ""}`, paidAt,
        },
      });
      res.noPersonMatch++; res.appliedCents += amountCents;
      res.unmatched.push({ email: email || "(no email)", amountCents, chargeId });
    } catch (e) {
      res.errors++;
      res.problems.push({ chargeId, email, note: e instanceof Error ? e.message.slice(0, 140) : "error" });
      console.error(`CSV reconcile row failed (${chargeId})`, e);
    }
  }

  await audit({
    entityType: "Payment", entityId: "csv-reconcile", action: "CSV_RECONCILE",
    summary: `CSV reconcile — ${res.markedById} by id, ${res.markedByEmail} by email, ${res.createdAttributed} newly recorded, ${res.alreadyDone + res.noOutstanding} already, ${res.noPersonMatch} no-person`,
  });

  return res;
}
