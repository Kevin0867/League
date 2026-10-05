import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Admin management of lesson promo codes: create, activate/deactivate, delete.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/profile/lessons/promos${qs}`, origin), 303);
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const op = g("op");

  if (op === "toggle") {
    const id = g("id"); if (!id) return back("?err=missing");
    const cur = await prisma.promoCode.findUnique({ where: { id }, select: { active: true } });
    if (!cur) return back("?err=missing");
    await prisma.promoCode.update({ where: { id }, data: { active: !cur.active } });
    return back("?ok=toggled");
  }
  if (op === "delete") {
    const id = g("id"); if (!id) return back("?err=missing");
    await prisma.promoCode.delete({ where: { id } }).catch(() => {});
    return back("?ok=deleted");
  }

  // Create.
  const code = g("code").toUpperCase().replace(/\s+/g, "");
  if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) return back("?err=code");
  const kind = g("kind") === "AMOUNT" ? "AMOUNT" : "PERCENT";
  const rawValue = parseFloat(g("value"));
  if (!Number.isFinite(rawValue) || rawValue <= 0) return back("?err=value");
  const value = kind === "PERCENT" ? Math.round(rawValue) : Math.round(rawValue * 100);
  if (kind === "PERCENT" && (value < 1 || value > 100)) return back("?err=value");

  const maxR = parseInt(g("maxRedemptions"), 10);
  const minA = parseFloat(g("minAmount"));
  const exp = g("expiresAt");

  const exists = await prisma.promoCode.findUnique({ where: { code }, select: { id: true } });
  if (exists) return back("?err=dup");

  await prisma.promoCode.create({
    data: {
      code, kind, value,
      maxRedemptions: Number.isFinite(maxR) && maxR > 0 ? maxR : null,
      minAmountCents: Number.isFinite(minA) && minA > 0 ? Math.round(minA * 100) : null,
      expiresAt: exp ? new Date(`${exp}T23:59:59`) : null,
      note: g("note") || null,
      active: true,
    },
  });
  await audit({ actorId: actor.userId, entityType: "PromoCode", entityId: code, action: "promo.create", summary: `Created promo ${code} (${kind === "PERCENT" ? value + "%" : "$" + (value / 100).toFixed(2)})` });
  return back("?ok=created");
}
