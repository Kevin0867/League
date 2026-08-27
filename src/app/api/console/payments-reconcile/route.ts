import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { isStripeConfigured } from "@/lib/stripe";
import { reconcileStripePayments } from "@/lib/payments/reconcile";

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
    });
    if (r.errors) params.set("recerrs", String(r.errors));
    return back(`?${params.toString()}`);
  } catch (e) {
    console.error("payments reconcile failed", e);
    return back(`?recerr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "reconcile failed")}`);
  }
}
