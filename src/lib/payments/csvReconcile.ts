import "server-only";
import { prisma } from "@/lib/db";
import { parseCsv } from "@/lib/domain/enrollmentImport";
import { audit } from "@/lib/audit";

// EXACT reconciliation from a Stripe "unified payments" CSV export — the
// authoritative path. Every academy charge in the file names its player in the
// "Checkout Line Item Summary" ("… season fee — Otto White · PURE Mesa MID Blue
// — 3-payment plan"), so we match a charge to the exact player by NAME — which
// never breaks the way a webhook, a metadata id, or an amount can. Matching, in
// order of confidence:
//   1. paymentId (metadata) → our Payment.id (one-time app checkouts).
//   2. player NAME from the summary → the Person → their season-fee row.
//   3. Customer Email → the Person → their season-fee row.
// A 3-payment plan (the row carries an Invoice ID / says "3-payment plan") sets
// the player's fee to an active subscription with installmentsPaid = the number
// of that player's cleared installments in the file. A one-time charge marks the
// fee paid in full. Fully idempotent: re-running (or an overlapping file) never
// double-counts — paid stays paid, and a plan's installment count only ever moves
// forward (max of what we already have and what the file shows).

export type CsvReconcileResult = {
  rows: number;
  paidRows: number;
  /** One-time fees matched to the exact Payment by our metadata id. */
  markedById: number;
  /** One-time fees matched to the player by the name in the line-item summary. */
  markedByName: number;
  /** One-time fees matched to the payer by email. */
  markedByEmail: number;
  /** Subscriptions (3-payment plans) set/advanced to their true installment count. */
  subscriptionsSet: number;
  /** Person found with no fee on file at all → recorded against them. */
  createdAttributed: number;
  /** Charge already represented here (paid, or plan already at that count) — skipped. */
  alreadyDone: number;
  /** Failed/declined rows — ignored, never create or clear anything. */
  skippedFailed: number;
  /** A player named in a charge couldn't be found here (needs a record). */
  noPersonMatch: number;
  errors: number;
  appliedCents: number; // total $ newly marked paid / newly collected
  unmatched: { who: string; amountCents: number; chargeId: string }[];
  problems: { chargeId: string; who: string; note: string }[];
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

const lc = (s: string) => (s ?? "").trim().toLowerCase();

/** Pull the player's name out of a Stripe line-item summary. */
function playerFromSummary(d: string): string {
  if (!d) return "";
  // "PURE Academy — Fall 2026 season fee — Otto White · PURE Mesa MID Blue (1); …"
  const m = d.match(/season fee\s*[—-]\s*([^·(;]+?)\s*(?:·|\(|;|$)/i);
  return m ? m[1].trim() : "";
}
const isPlanSummary = (d: string) => /3-?\s*payment plan|payment plan/i.test(d ?? "");

/** Covered players of a fee row: the coveredPersonIds list, or its own payer. */
function coversOf(p: { partyId: string | null; coveredPersonIds: unknown }): string[] {
  const arr = Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return arr.length ? arr : p.partyId ? [p.partyId] : [];
}

type FeeRow = {
  id: string; partyId: string | null; coveredPersonIds: unknown; amountCents: number;
  status: string; category: string; installmentPlan: boolean; installmentsPaid: number;
  installmentsTotal: number | null; stripePaymentIntentId: string | null; paidAt: Date | null;
};

/** Choose the fee row to act on for a player: prefer one that isn't settled, and
 *  an existing plan over a plain request. */
function pickFee(fees: FeeRow[]): FeeRow | null {
  if (!fees.length) return null;
  return (
    fees.find((f) => f.installmentPlan && f.status !== "PAID") ??
    fees.find((f) => ["REQUESTED", "PENDING", "FAILED"].includes(f.status)) ??
    fees.find((f) => f.status !== "REFUNDED") ??
    fees[0]
  );
}

export async function reconcileFromCsv(text: string, seasonId: string | null): Promise<CsvReconcileResult> {
  const res: CsvReconcileResult = {
    rows: 0, paidRows: 0, markedById: 0, markedByName: 0, markedByEmail: 0, subscriptionsSet: 0,
    createdAttributed: 0, alreadyDone: 0, skippedFailed: 0, noPersonMatch: 0, errors: 0,
    appliedCents: 0, unmatched: [], problems: [],
  };

  const table = parseCsv(text);
  if (table.length < 2) return res;
  const find = colFinder(table[0]);
  const idxId = find((h) => h === "id");
  const idxAmount = find((h) => h === "amount");
  const idxStatus = find((h) => h === "status");
  const idxEmail = find((h) => h === "customer email");
  const idxPaymentId = find((h) => h.includes("paymentid"));
  const idxInvoice = find((h) => h === "invoice id");
  const idxSummary = find((h) => h.includes("line item summary"));
  const idxCreated = find((h) => h.includes("created") && h.includes("date"));
  const get = (row: string[], i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");

  // ---- Pass 1: parse every paid row into a normalized record. ----
  type Rec = { chargeId: string; email: string; pid: string; invoiceId: string; name: string; isPlan: boolean; amountCents: number; paidAt: Date };
  const recs: Rec[] = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (row.every((c) => !c || !c.trim())) continue;
    res.rows++;
    const status = lc(get(row, idxStatus));
    if (idxStatus >= 0 && status !== "paid" && status !== "succeeded") { res.skippedFailed++; continue; }
    res.paidRows++;
    const summary = get(row, idxSummary);
    const createdRaw = get(row, idxCreated);
    let paidAt = new Date();
    if (createdRaw) { const d = new Date(createdRaw.replace(" ", "T") + "Z"); if (!isNaN(d.getTime())) paidAt = d; }
    recs.push({
      chargeId: get(row, idxId), email: lc(get(row, idxEmail)), pid: get(row, idxPaymentId),
      invoiceId: get(row, idxInvoice), name: playerFromSummary(summary),
      isPlan: !!get(row, idxInvoice) || isPlanSummary(summary),
      amountCents: cents(get(row, idxAmount)), paidAt,
    });
  }
  if (!recs.length) return res;

  // ---- Bulk pre-load everything we match against (a handful of queries, not
  //      thousands) so a full-season file reconciles fast and never times out. ----
  const pids = [...new Set(recs.map((r) => r.pid).filter(Boolean))];
  const chargeIds = [...new Set(recs.map((r) => r.chargeId).filter(Boolean))];
  const feeSelect = { id: true, partyId: true, coveredPersonIds: true, amountCents: true, status: true, category: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true, stripePaymentIntentId: true, paidAt: true } as const;

  const [byPidRows, byChargeRows, people, seasonFees] = await Promise.all([
    pids.length ? prisma.payment.findMany({ where: { id: { in: pids } }, select: feeSelect }) : Promise.resolve([] as FeeRow[]),
    chargeIds.length ? prisma.payment.findMany({ where: { stripePaymentIntentId: { in: chargeIds } }, select: feeSelect }) : Promise.resolve([] as FeeRow[]),
    // All people — matched by name (case-insensitively) and by any email on file.
    prisma.person.findMany({ select: { id: true, firstName: true, lastName: true, email: true, email2: true, email3: true } }),
    // Every season fee row, so we can find a player's fee in memory.
    prisma.payment.findMany({
      where: { direction: "IN", category: "PLAYER_FEE", ...(seasonId ? { seasonId } : {}) },
      select: feeSelect,
    }),
  ]);

  const byPid = new Map(byPidRows.map((p) => [p.id, p]));
  const byCharge = new Map(byChargeRows.filter((p) => p.stripePaymentIntentId).map((p) => [p.stripePaymentIntentId as string, p]));

  // Name / email → person id.
  const personByName = new Map<string, string[]>();
  const personByEmail = new Map<string, string>();
  for (const p of people) {
    const full = lc(`${p.firstName} ${p.lastName}`);
    if (full.trim()) { const a = personByName.get(full) ?? []; a.push(p.id); personByName.set(full, a); }
    for (const e of [p.email, p.email2, p.email3]) if (e) personByEmail.set(lc(e), p.id);
  }
  // Also index by first+last token, so "Mary Jo Smith" ↔ firstName "Mary Jo".
  const personByTokens = new Map<string, string[]>();
  for (const p of people) {
    const t = lc(`${(p.firstName ?? "").split(/\s+/)[0]} ${(p.lastName ?? "").split(/\s+/).pop() ?? ""}`);
    if (t.trim()) { const a = personByTokens.get(t) ?? []; a.push(p.id); personByTokens.set(t, a); }
  }

  // Person id → their season-fee rows.
  const feesByPerson = new Map<string, FeeRow[]>();
  for (const f of seasonFees) for (const pid of coversOf(f)) {
    const a = feesByPerson.get(pid) ?? []; a.push(f); feesByPerson.set(pid, a);
  }

  // Resolve a record to a person id: by summary name, then by email. When a name
  // is ambiguous (duplicate person records — common after a person-split), pick
  // the record that actually HAS a covering fee this season, then an unpaid one,
  // then the payer email. This is what fixes a player like Otto whose name maps to
  // two records but only one carries the season fee.
  const hasFee = (id: string) => (feesByPerson.get(id) ?? []).length > 0;
  const hasUnpaidFee = (id: string) => (feesByPerson.get(id) ?? []).some((f) => f.status !== "PAID" && f.status !== "REFUNDED");
  const resolvePerson = (rec: Rec): string | null => {
    const cands = new Set<string>();
    if (rec.name) {
      const full = lc(rec.name);
      (personByName.get(full) ?? []).forEach((id) => cands.add(id));
      if (cands.size === 0) {
        const toks = rec.name.trim().split(/\s+/);
        (personByTokens.get(lc(`${toks[0]} ${toks[toks.length - 1]}`)) ?? []).forEach((id) => cands.add(id));
      }
    }
    const list = [...cands];
    if (list.length === 1) return list[0];
    if (list.length > 1) {
      const unpaid = list.filter(hasUnpaidFee);
      if (unpaid.length === 1) return unpaid[0];
      const withFee = list.filter(hasFee);
      if (withFee.length === 1) return withFee[0];
      const byEmail = rec.email ? personByEmail.get(rec.email) : undefined;
      if (byEmail && list.includes(byEmail)) return byEmail;
      if (unpaid.length > 1) return unpaid[0];
      if (withFee.length > 1) return withFee[0];
      return null; // genuinely can't tell them apart
    }
    // No name match → payer email.
    return rec.email ? personByEmail.get(rec.email) ?? null : null;
  };

  // ---- Split into subscription installments and one-time charges. ----
  const subs = recs.filter((r) => r.isPlan);
  const oneTime = recs.filter((r) => !r.isPlan);

  // ---- One-time charges: mark the exact fee paid in full. ----
  for (const rec of oneTime) {
    try {
      // Idempotency: this exact charge already recorded.
      if (rec.chargeId && byCharge.has(rec.chargeId)) {
        const seen = byCharge.get(rec.chargeId)!;
        if (seen.status !== "PAID" && !seen.installmentPlan) {
          await prisma.payment.update({ where: { id: seen.id }, data: { status: "PAID", paidAt: seen.paidAt ?? rec.paidAt } });
          seen.status = "PAID"; res.markedById++; res.appliedCents += seen.amountCents;
        } else res.alreadyDone++;
        continue;
      }
      // 1) Exact by our payment id.
      if (rec.pid) {
        const pay = byPid.get(rec.pid);
        if (pay) {
          if (pay.status === "PAID" || pay.installmentPlan) res.alreadyDone++;
          else {
            await prisma.payment.update({ where: { id: pay.id }, data: { status: "PAID", paidAt: pay.paidAt ?? rec.paidAt, stripePaymentIntentId: rec.chargeId || pay.stripePaymentIntentId } });
            pay.status = "PAID"; res.markedById++; res.appliedCents += pay.amountCents;
          }
          continue;
        }
      }
      // 2/3) By player name, then email → their fee row.
      const personId = resolvePerson(rec);
      if (!personId) { res.noPersonMatch++; res.unmatched.push({ who: rec.name || rec.email || "(unknown)", amountCents: rec.amountCents, chargeId: rec.chargeId }); continue; }
      const fee = pickFee(feesByPerson.get(personId) ?? []);
      if (fee) {
        if (fee.status === "PAID") { res.alreadyDone++; continue; }
        await prisma.payment.update({ where: { id: fee.id }, data: { status: "PAID", paidAt: fee.paidAt ?? rec.paidAt, stripePaymentIntentId: rec.chargeId || fee.stripePaymentIntentId } });
        fee.status = "PAID";
        (rec.name && personByName.get(lc(rec.name))?.length === 1) ? res.markedByName++ : res.markedByEmail++;
        res.appliedCents += fee.amountCents;
        continue;
      }
      // No fee on file — record the money against them so it's not lost.
      await prisma.payment.create({ data: { direction: "IN", method: "STRIPE", status: "PAID", category: "PLAYER_FEE", amountCents: rec.amountCents, partyId: personId, seasonId, stripePaymentIntentId: rec.chargeId || undefined, description: "Recorded from Stripe CSV (no fee request on file)", paidAt: rec.paidAt } });
      res.createdAttributed++; res.appliedCents += rec.amountCents;
    } catch (e) {
      res.errors++;
      res.problems.push({ chargeId: rec.chargeId, who: rec.name || rec.email, note: e instanceof Error ? e.message.slice(0, 140) : "error" });
    }
  }

  // ---- Subscription installments: group by player, set the plan's true count. ----
  const subCount = new Map<string, { count: number; paidAt: Date; rec: Rec }>();
  const subUnresolved: Rec[] = [];
  for (const rec of subs) {
    const personId = resolvePerson(rec);
    if (!personId) { subUnresolved.push(rec); continue; }
    const cur = subCount.get(personId);
    if (cur) { cur.count++; if (rec.paidAt > cur.paidAt) cur.paidAt = rec.paidAt; }
    else subCount.set(personId, { count: 1, paidAt: rec.paidAt, rec });
  }
  for (const [personId, info] of subCount) {
    try {
      const total = 3;
      const paidN = Math.min(total, info.count);
      const fee = pickFee(feesByPerson.get(personId) ?? []);
      if (!fee) {
        // No fee row yet — create the plan against them (billed amount unknown here,
        // so use the season fee if we can infer it; otherwise leave amount at the
        // installment total × 3 is not knowable, so record a placeholder full fee).
        await prisma.payment.create({ data: { direction: "IN", method: "STRIPE", status: paidN >= total ? "PAID" : "PENDING", category: "PLAYER_FEE", amountCents: info.rec.amountCents * total, partyId: personId, seasonId, installmentPlan: true, installmentsTotal: total, installmentsPaid: paidN, description: "Subscription recorded from Stripe CSV (no fee request on file)", paidAt: paidN >= total ? info.paidAt : null } });
        res.subscriptionsSet++; res.appliedCents += info.rec.amountCents * paidN;
        continue;
      }
      if (fee.status === "PAID") { res.alreadyDone++; continue; }
      // Only ever move forward: never lower a plan the API reconcile already advanced.
      const newPaid = Math.max(fee.installmentsPaid ?? 0, paidN);
      const done = newPaid >= (fee.installmentsTotal ?? total);
      const changed = !fee.installmentPlan || (fee.installmentsPaid ?? 0) !== newPaid || (done && fee.status !== "PAID");
      if (!changed) { res.alreadyDone++; continue; }
      await prisma.payment.update({
        where: { id: fee.id },
        data: {
          installmentPlan: true,
          installmentsTotal: fee.installmentsTotal ?? total,
          installmentsPaid: newPaid,
          status: done ? "PAID" : "PENDING",
          ...(done ? { paidAt: fee.paidAt ?? info.paidAt } : {}),
        },
      });
      res.subscriptionsSet++;
      // Newly-collected share = per-installment × how many we just added.
      const perInstallment = Math.round(fee.amountCents / (fee.installmentsTotal ?? total));
      res.appliedCents += perInstallment * (newPaid - (fee.installmentsPaid ?? 0));
    } catch (e) {
      res.errors++;
      res.problems.push({ chargeId: info.rec.chargeId, who: info.rec.name || info.rec.email, note: e instanceof Error ? e.message.slice(0, 140) : "error" });
    }
  }
  for (const rec of subUnresolved) {
    res.noPersonMatch++;
    res.unmatched.push({ who: rec.name || rec.email || "(unknown)", amountCents: rec.amountCents, chargeId: rec.chargeId });
  }

  await audit({
    entityType: "Payment", entityId: "csv-reconcile", action: "CSV_RECONCILE",
    summary: `CSV reconcile — ${res.markedById} by id, ${res.markedByName} by name, ${res.markedByEmail} by email, ${res.subscriptionsSet} subscriptions set, ${res.createdAttributed} newly recorded, ${res.noPersonMatch} unmatched`,
  });
  return res;
}
