import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { seedCourtCostEntries, courtCostByNameForMonth } from "@/lib/domain/pnl";

const COURT_PREFIX = "Court rent — ";

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
  // Preserve the chosen date range (returnTo already carries ?from=&to=).
  const back = (flag: string) => NextResponse.redirect(new URL(`${dest}${dest.includes("?") ? "&" : "?"}${flag}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isAdmin(actor.roles)) return back("err=auth");

  if (op === "add") {
    const month = String(fd.get("month") ?? "").trim();
    const section = String(fd.get("section") ?? "").trim().toUpperCase();
    const label = String(fd.get("label") ?? "").trim().slice(0, 120);
    const kind = normKind(String(fd.get("kind") ?? ""));
    const amountCents = dollarsToCents(String(fd.get("amount") ?? ""));
    const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
    if (!/^\d{4}-\d{2}$/.test(month) || !["REVENUE", "EXPENSE"].includes(section) || !label) return back("err=fields");
    const created = await prisma.pnlEntry.create({ data: { month, section, label, kind, amountCents, note } });
    await audit({ actorId: actor.userId, entityType: "PnlEntry", entityId: created.id, action: "pnl.add", summary: `Added ${section.toLowerCase()} "${label}" (${month})` });
    return back("ok=added");
  }

  if (op === "update") {
    const id = String(fd.get("id") ?? "").trim();
    const existing = id ? await prisma.pnlEntry.findUnique({ where: { id }, select: { id: true, kind: true, label: true, month: true } }) : null;
    if (!existing) return back("err=notfound");
    const label = String(fd.get("label") ?? "").trim().slice(0, 120);
    const month = String(fd.get("month") ?? "").trim();
    const kind = normKind(String(fd.get("kind") ?? ""));
    let amountCents = dollarsToCents(String(fd.get("amount") ?? ""));
    const effLabel = label || existing.label;
    const effMonth = /^\d{4}-\d{2}$/.test(month) ? month : existing.month;
    // Court-rent lines recompute from the facility rates WHEN THEIR TYPE CHANGES:
    // Forecast = the whole month's scheduled practices, Actual = delivered so far.
    // (An amount edit without a type change is respected as a manual override.)
    if (effLabel.startsWith(COURT_PREFIX) && kind !== existing.kind) {
      const name = effLabel.slice(COURT_PREFIX.length);
      const byName = await courtCostByNameForMonth(effMonth, kind === "FORECAST" ? "scheduled" : "delivered");
      if (byName.has(name)) amountCents = byName.get(name)!;
    }
    await prisma.pnlEntry.update({ where: { id }, data: { ...(label ? { label } : {}), ...(/^\d{4}-\d{2}$/.test(month) ? { month } : {}), kind, amountCents } });
    return back("ok=saved");
  }

  // Pull the computed court rent into editable line items — one per facility for
  // each month in the chosen range. Re-pulling refreshes the amounts.
  if (op === "pullCourtCosts") {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = String(fd.get("from") ?? "").trim();
    const to = String(fd.get("to") ?? "").trim();
    if (!dayRe.test(from) || !dayRe.test(to) || from > to) return back("err=fields");
    const { created, updated, removed } = await seedCourtCostEntries(from, to);
    await audit({ actorId: actor.userId, entityType: "PnlEntry", entityId: "court", action: "pnl.pullCourtCosts", summary: `Pulled court rent (${created} added, ${updated} updated, ${removed} removed)` });
    return back(`ok=courtpulled&n=${created + updated}`);
  }

  if (op === "delete") {
    const id = String(fd.get("id") ?? "").trim();
    const existing = id ? await prisma.pnlEntry.findUnique({ where: { id }, select: { id: true } }) : null;
    if (!existing) return back("err=notfound");
    await prisma.pnlEntry.delete({ where: { id } });
    return back("ok=deleted");
  }

  return back("err=op");
}
