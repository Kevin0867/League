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
