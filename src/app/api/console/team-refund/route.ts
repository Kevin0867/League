import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { executeTeamRefund } from "@/lib/payments/teamRefund";

// Issue a fixed partial refund to every member of a team (e.g. refunding a few
// cancelled practices). The team page renders a LOCAL preview first; this
// endpoint does the real Stripe refunds on confirm. Idempotent per charge.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const teamId = String(fd.get("teamId") ?? "").trim();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/teams/${teamId}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  // Refunds move real money — same gate as payouts/reconcile.
  if (!actor || !can(actor.role, "runPayouts")) return back("?rferr=auth");
  if (!teamId) return NextResponse.redirect(new URL("/console/teams", origin), 303);

  const dollars = parseFloat(String(fd.get("amount") ?? ""));
  const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
  const reason = String(fd.get("reason") ?? "").trim();
  if (amountCents <= 0) return back("?rferr=amount");

  try {
    const r = await executeTeamRefund({ teamId, amountCents, reason, actorId: actor.userId });
    const params = new URLSearchParams({
      rfdone: "1",
      rfdid: String(r.refunded),
      rfcents: String(r.refundedCents),
      rfskip: String(r.skipped),
      rffail: String(r.failed),
    });
    return back(`?${params.toString()}`);
  } catch (e) {
    console.error("team refund failed", e);
    return back(`?rferr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "refund failed")}`);
  }
}
