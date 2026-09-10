import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isStripeConfigured } from "@/lib/stripe";
import { reconcileStripePayments, undoStripeImport } from "@/lib/payments/reconcile";

// Reconcile local payments against Stripe: find any payment completed in Stripe
// but not yet recorded PAID here, and record it. Idempotent — safe to re-run.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/payments${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "runPayouts")) return back("?err=auth");

  // Purge the $0.00 imported charges — Stripe's card-verification / setup
  // authorizations that got imported as empty "needs filing" rows. This only
  // deletes local rows, so it works whether or not Stripe is configured; scoped
  // hard to STRIPE_IMPORT + amountCents 0 so nothing with money is touched.
  if (String(fd.get("op") ?? "") === "remove-zero-imports") {
    try {
      const del = await prisma.payment.deleteMany({
        where: { direction: "IN", category: "STRIPE_IMPORT", amountCents: 0 },
      });
      await audit({
        actorId: actor.userId, entityType: "Payment", entityId: "reconcile", action: "IMPORT_REVERTED",
        summary: `Removed ${del.count} zero-dollar imported charge(s) (Stripe card verifications)`,
      });
      return back(`?zeroremoved=${del.count}`);
    } catch (e) {
      console.error("remove zero imports failed", e);
      return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "cleanup failed")}`);
    }
  }

  if (!isStripeConfigured()) return back("?recerr=notconfigured");

  // Revert the historical over-import: remove the pre-floor auto-imported rows
  // that inflated revenue, without touching today-and-forward imports.
  if (String(fd.get("op") ?? "") === "undo-import") {
    try {
      const u = await undoStripeImport();
      await audit({
        actorId: actor.userId, entityType: "Payment", entityId: "reconcile", action: "IMPORT_REVERTED",
        summary: `Reverted ${u.removed} pre-today imported rows ($${Math.round(u.removedCents / 100)})`,
      });
      return back(`?undook=1&removed=${u.removed}&remcents=${u.removedCents}`);
    } catch (e) {
      console.error("undo import failed", e);
      return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "undo failed")}`);
    }
  }

  // Delete a single payment record — for cleaning up erroneous/failed rows.
  if (String(fd.get("op") ?? "") === "deletePayment") {
    const paymentId = String(fd.get("paymentId") ?? "");
    if (!paymentId) return back("?err=missing");
    try {
      const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, amountCents: true, status: true, direction: true, party: { select: { firstName: true, lastName: true } } } });
      if (!pay) return back("?err=notfound");
      await prisma.payment.delete({ where: { id: paymentId } }); // apparel items cascade
      await audit({
        actorId: actor.userId, entityType: "Payment", entityId: paymentId, action: "DELETED",
        summary: `Deleted ${pay.direction} ${pay.status} payment ($${Math.round(pay.amountCents / 100)})${pay.party ? ` for ${pay.party.firstName} ${pay.party.lastName}` : ""}`,
      });
      return back("?delok=1");
    } catch (e) {
      console.error("delete payment failed", e);
      return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "delete failed")}`);
    }
  }

  // Assign an unmatched Stripe-CSV charge to a player, by hand. These charges
  // name no player we could find (often only the payer's email is on the charge,
  // and it isn't on any record), so an admin picks the player here. We mark that
  // player's outstanding season fee PAID for this charge — or, if they have no
  // fee on file, record one — stamping the Stripe charge id so a later CSV
  // re-upload recognizes it and never double-counts. The payer email, if new, is
  // saved to an empty slot on the record so future charges auto-match.
  if (String(fd.get("op") ?? "") === "assign-csv-charge") {
    const chargeId = String(fd.get("chargeId") ?? "").trim();
    const personId = String(fd.get("personId") ?? "").trim();
    const amountCents = Math.max(0, Math.round(Number(fd.get("amountCents") ?? 0)));
    const payerEmail = String(fd.get("payerEmail") ?? "").trim().toLowerCase();
    // A subscription installment (3-payment plan): record paying-by-plan (1st
    // installment in), NOT paid-in-full. The charge is one installment, so a
    // brand-new plan row's full total is that installment × 3.
    const isPlan = String(fd.get("isPlan") ?? "") === "1";
    if (!personId || !chargeId || !amountCents) return back("?recerr=missing");
    try {
      // Idempotency: this exact charge already recorded here — just make sure it's
      // attached to the chosen player and settled the right way, never a 2nd row.
      const existing = await prisma.payment.findFirst({
        where: { direction: "IN", stripePaymentIntentId: chargeId },
        select: { id: true, status: true, installmentsPaid: true, amountCents: true },
      });
      const activeSeason = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } });
      if (existing) {
        await prisma.payment.update({
          where: { id: existing.id },
          data: {
            partyId: personId,
            ...(isPlan
              ? { installmentPlan: true, installmentsTotal: 3, installmentsPaid: Math.max(1, existing.installmentsPaid ?? 0), status: "PENDING", method: "STRIPE" }
              : existing.status !== "PAID" ? { status: "PAID", paidAt: new Date() } : {}),
            ...(activeSeason ? { seasonId: activeSeason.id } : {}),
          },
        });
        await audit({ actorId: actor.userId, entityType: "Payment", entityId: existing.id, action: isPlan ? "SCHEDULED" : "ATTRIBUTED", summary: `Assigned Stripe ${isPlan ? "plan installment" : "charge"} ${chargeId} to person ${personId}` });
      } else {
        // Prefer settling their real outstanding season fee (so the request they
        // were sent reflects reality), else record the money against them.
        const fee = await prisma.payment.findFirst({
          where: { direction: "IN", category: "PLAYER_FEE", partyId: personId, status: { in: ["REQUESTED", "PENDING", "FAILED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, paidAt: true, installmentsPaid: true },
        });
        if (fee) {
          await prisma.payment.update({
            where: { id: fee.id },
            data: isPlan
              ? { installmentPlan: true, installmentsTotal: 3, installmentsPaid: Math.max(1, fee.installmentsPaid ?? 0), status: "PENDING", method: "STRIPE", stripePaymentIntentId: chargeId }
              : { status: "PAID", paidAt: fee.paidAt ?? new Date(), method: "STRIPE", stripePaymentIntentId: chargeId },
          });
          await audit({ actorId: actor.userId, entityType: "Payment", entityId: fee.id, action: isPlan ? "SCHEDULED" : "PAID", summary: `${isPlan ? "Marked season fee as paying-by-plan (1st installment)" : "Marked season fee paid"} from Stripe charge ${chargeId} (assigned by admin)` });
        } else {
          const created = await prisma.payment.create({
            data: {
              direction: "IN", method: "STRIPE", category: "PLAYER_FEE",
              partyId: personId, seasonId: activeSeason?.id ?? null,
              stripePaymentIntentId: chargeId,
              ...(isPlan
                ? { status: "PENDING", installmentPlan: true, installmentsTotal: 3, installmentsPaid: 1, amountCents: amountCents * 3, description: "Assigned from Stripe CSV — 3-payment plan (no fee request on file)" }
                : { status: "PAID", paidAt: new Date(), amountCents, description: "Assigned from Stripe CSV (no fee request on file)" }),
            },
          });
          await audit({ actorId: actor.userId, entityType: "Payment", entityId: created.id, action: isPlan ? "SCHEDULED" : "IMPORTED", summary: `Recorded Stripe charge ${chargeId} as ${isPlan ? "3-payment plan (1st installment)" : "paid fee"} (assigned by admin)` });
        }
      }
      // Save the payer email to an empty slot so this family auto-matches next time.
      if (payerEmail && /@/.test(payerEmail)) {
        const person = await prisma.person.findUnique({ where: { id: personId }, select: { email: true, email2: true, email3: true } });
        if (person) {
          const known = [person.email, person.email2, person.email3].map((e) => (e ?? "").toLowerCase());
          if (!known.includes(payerEmail)) {
            const slot = !person.email ? "email" : !person.email2 ? "email2" : !person.email3 ? "email3" : null;
            if (slot) await prisma.person.update({ where: { id: personId }, data: { [slot]: payerEmail } });
          }
        }
      }
      // Re-show the remaining unmatched charges (minus this one) so the admin can
      // keep assigning without re-uploading the CSV between each.
      const params = new URLSearchParams({ assignok: "1" });
      try {
        const list = JSON.parse(String(fd.get("remaining") ?? "[]")) as Array<{ w: string; c: number; id?: string }>;
        const rest = list.filter((u) => u.id && u.id !== chargeId);
        if (rest.length) params.set("csvunmatched", JSON.stringify(rest).slice(0, 3500));
      } catch { /* no list carried — just show the success note */ }
      return back(`?${params.toString()}`);
    } catch (e) {
      console.error("assign csv charge failed", e);
      return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "assign failed")}`);
    }
  }

  // Attribute an imported charge: attach it to a family and/or set its real
  // category so it lands in the right reports.
  if (String(fd.get("op") ?? "") === "attribute") {
    const paymentId = String(fd.get("paymentId") ?? "");
    const personId = String(fd.get("personId") ?? "").trim() || null;
    const category = String(fd.get("category") ?? "").trim().toUpperCase() || null;
    if (!paymentId) return back("?recerr=missing");
    try {
      const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, direction: true } });
      if (!pay || pay.direction !== "IN") return back("?recerr=notfound");
      // Keep the person's active season on the row when we know it, so revenue
      // reports scoped to the season pick it up.
      const activeSeason = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } });
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          ...(personId ? { partyId: personId } : {}),
          ...(category ? { category } : {}),
          ...(activeSeason ? { seasonId: activeSeason.id } : {}),
        },
      });
      await audit({
        actorId: actor.userId, entityType: "Payment", entityId: paymentId, action: "ATTRIBUTED",
        summary: `Attributed imported charge${personId ? ` to person ${personId}` : ""}${category ? ` · ${category}` : ""}`,
      });
      return back("?attrok=1");
    } catch (e) {
      console.error("attribute import failed", e);
      return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "attribute failed")}`);
    }
  }

  try {
    const r = await reconcileStripePayments();
    await audit({
      actorId: actor.userId,
      entityType: "Payment",
      entityId: "reconcile",
      action: "RECONCILE_RUN",
      summary: `Reconciled against Stripe — ${r.chargesScanned} charges scanned, ${r.nowPaid} rows newly paid, ${r.imported} imported (${Math.round((r.recoveredCents + r.importedCents) / 100)} dollars added)${r.errors ? `, ${r.errors} errors` : ""}`,
    });
    const params = new URLSearchParams({
      recok: "1",
      scanned: String(r.scanned + r.chargesScanned),
      paid: String(r.nowPaid),
      updated: String(r.updated),
      cents: String(r.recoveredCents),
      imported: String(r.imported),
      impcents: String(r.importedCents),
      unattributed: String(r.importedUnattributed),
      refunds: String(r.refundsRecorded),
      refcents: String(r.refundedCents),
      scancents: String(r.chargesScannedCents),
      already: String(r.alreadyRecorded),
      alreadycents: String(r.alreadyRecordedCents),
      histn: String(r.unmatchedBeforeFloor),
      histcents: String(r.unmatchedBeforeFloorCents),
    });
    if (r.errors) params.set("recerrs", String(r.errors));
    if (r.firstError) params.set("recerrwhy", r.firstError.slice(0, 160));
    return back(`?${params.toString()}`);
  } catch (e) {
    console.error("payments reconcile failed", e);
    return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "reconcile failed")}`);
  }
}
