import { NextResponse } from "next/server";
import { reconcileStripePayments } from "@/lib/payments/reconcile";
import { audit } from "@/lib/audit";

// Daily job (Vercel Cron, see vercel.json): reconcile local payments against
// Stripe so a missed webhook never leaves revenue unrecorded. Idempotent.
// Protected by CRON_SECRET when set.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const r = await reconcileStripePayments();
  if (r.nowPaid > 0 || r.errors > 0) {
    await audit({
      entityType: "Payment",
      entityId: "reconcile",
      action: "RECONCILE_CRON",
      summary: `Nightly reconcile — ${r.nowPaid} newly recorded paid, ${Math.round(r.recoveredCents / 100)} dollars recovered${r.errors ? `, ${r.errors} errors` : ""}`,
    });
  }
  return NextResponse.json(r);
}
