import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { APPAREL_GARMENTS, APPAREL_SIZES, unitPriceCents, garmentLabel, sizeLabel } from "@/lib/domain/apparel";

// Apparel fulfillment: advance paid orders through PENDING → ORDERED → DELIVERED,
// in bulk (whole status band) or one line at a time.
export const dynamic = "force-dynamic";

const STATUSES = new Set(["PENDING", "ORDERED", "DELIVERED"]);

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const rawReturn = String(formData.get("returnTo") ?? "");
  const base = rawReturn.startsWith("/console/") ? rawReturn : "/console/apparel";
  const back = (qs: string) => NextResponse.redirect(new URL(`${base}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
  const op = String(formData.get("op") ?? "");

  if (op === "advance") {
    const from = String(formData.get("from") ?? "");
    const to = String(formData.get("to") ?? "");
    if (!STATUSES.has(from) || !STATUSES.has(to)) return back("?err=fields");
    // Only paid orders are fulfilled — including a payment plan whose first
    // installment (which carries the apparel charge) has cleared.
    const ids = (
      await prisma.apparelOrderItem.findMany({
        where: { fulfillment: from, payment: { OR: [{ status: "PAID" }, { installmentPlan: true, installmentsPaid: { gte: 1 } }] } },
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

  // Fix a wrong apparel choice — garment (T-shirt/tank), size (youth↔adult), or
  // quantity. On an unpaid order the unit price is refreshed to the current rate
  // for the chosen garment; on a PAID order the price stays as charged.
  if (op === "editItem") {
    const id = String(formData.get("id") ?? "");
    const garment = String(formData.get("garment") ?? "");
    const size = String(formData.get("size") ?? "");
    const quantity = Math.max(1, Math.min(20, parseInt(String(formData.get("quantity") ?? "1"), 10) || 1));
    if (!id || !APPAREL_GARMENTS.some((g) => g.key === garment) || !APPAREL_SIZES.some((s) => s.key === size)) return back("?err=fields");
    const item = await prisma.apparelOrderItem.findUnique({ where: { id }, include: { payment: { select: { status: true } } } });
    if (!item) return back("?err=fields");
    const data: { garment: string; size: string; quantity: number; unitPriceCents?: number } = { garment, size, quantity };
    if (item.payment.status !== "PAID") {
      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      data.unitPriceCents = unitPriceCents(garment, rate?.shirtPriceCents ?? 2500, rate?.tankPriceCents ?? 2500);
    }
    await prisma.apparelOrderItem.update({ where: { id }, data });
    await audit({ actorId: actor.userId, entityType: "ApparelOrderItem", entityId: id, action: "UPDATE", summary: `Apparel changed to ${quantity}× ${garmentLabel(garment)} · ${sizeLabel(size)}` });
    return back("?ok=itemedited");
  }

  return back("?err=op");
}
