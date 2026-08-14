import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Apparel fulfillment: advance paid orders through PENDING → ORDERED → DELIVERED,
// in bulk (whole status band) or one line at a time.
export const dynamic = "force-dynamic";

const STATUSES = new Set(["PENDING", "ORDERED", "DELIVERED"]);

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/apparel${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
  const op = String(formData.get("op") ?? "");

  if (op === "advance") {
    const from = String(formData.get("from") ?? "");
    const to = String(formData.get("to") ?? "");
    if (!STATUSES.has(from) || !STATUSES.has(to)) return back("?err=fields");
    // Only paid orders are fulfilled.
    const ids = (
      await prisma.apparelOrderItem.findMany({
        where: { fulfillment: from, payment: { status: "PAID" } },
        select: { id: true },
      })
    ).map((r) => r.id);
    if (ids.length) await prisma.apparelOrderItem.updateMany({ where: { id: { in: ids } }, data: { fulfillment: to } });
    await audit({ actorId: actor.userId, entityType: "System", entityId: "apparel", action: "UPDATE", summary: `Apparel ${from}→${to}: ${ids.length} item(s)` });
    return back(`?ok=advanced&n=${ids.length}`);
  }

  if (op === "setOne") {
    const id = String(formData.get("id") ?? "");
    const to = String(formData.get("to") ?? "");
    if (!id || !STATUSES.has(to)) return back("?err=fields");
    await prisma.apparelOrderItem.update({ where: { id }, data: { fulfillment: to } });
    return back("?ok=set");
  }

  return back("?err=op");
}
