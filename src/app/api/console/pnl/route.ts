import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Editable P&L line items. Admin-only. Amounts entered in dollars, stored cents.
function dollarsToCents(v: string): number {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const normKind = (v: string) => (String(v).trim().toUpperCase() === "FORECAST" ? "FORECAST" : "ACTUAL");

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const rawReturn = String(fd.get("returnTo") ?? "").trim();
  const dest = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/console/pnl";
  const back = (qs: string) => NextResponse.redirect(new URL(`${dest}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isAdmin(actor.roles)) return back("?err=auth");

  if (op === "add") {
    const month = String(fd.get("month") ?? "").trim();
    const section = String(fd.get("section") ?? "").trim().toUpperCase();
    const label = String(fd.get("label") ?? "").trim().slice(0, 120);
    const kind = normKind(String(fd.get("kind") ?? ""));
    const amountCents = dollarsToCents(String(fd.get("amount") ?? ""));
    const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
    if (!/^\d{4}-\d{2}$/.test(month) || !["REVENUE", "EXPENSE"].includes(section) || !label) return back("?err=fields");
    const created = await prisma.pnlEntry.create({ data: { month, section, label, kind, amountCents, note } });
    await audit({ actorId: actor.userId, entityType: "PnlEntry", entityId: created.id, action: "pnl.add", summary: `Added ${section.toLowerCase()} "${label}" (${month})` });
    return back(`?month=${month}&ok=added`);
  }

  if (op === "update") {
    const id = String(fd.get("id") ?? "").trim();
    const existing = id ? await prisma.pnlEntry.findUnique({ where: { id }, select: { month: true } }) : null;
    if (!existing) return back("?err=notfound");
    const label = String(fd.get("label") ?? "").trim().slice(0, 120);
    const kind = normKind(String(fd.get("kind") ?? ""));
    const amountCents = dollarsToCents(String(fd.get("amount") ?? ""));
    await prisma.pnlEntry.update({ where: { id }, data: { ...(label ? { label } : {}), kind, amountCents } });
    return back(`?month=${existing.month}&ok=saved`);
  }

  if (op === "delete") {
    const id = String(fd.get("id") ?? "").trim();
    const existing = id ? await prisma.pnlEntry.findUnique({ where: { id }, select: { month: true } }) : null;
    if (!existing) return back("?err=notfound");
    await prisma.pnlEntry.delete({ where: { id } });
    return back(`?month=${existing.month}&ok=deleted`);
  }

  return back("?err=op");
}
