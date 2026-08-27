import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { reconcileFromCsv } from "@/lib/payments/csvReconcile";

// Exact reconciliation from an uploaded Stripe "unified payments" CSV. Native
// multipart POST (carries the session cookie reliably on this runtime). Gated
// to runPayouts like the other reconcile actions.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/payments${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "runPayouts")) return back("?err=auth");

  const file = fd.get("file");
  const text = file instanceof File ? await file.text() : String(fd.get("text") ?? "");
  if (!text.trim()) return back("?csverr=empty");

  try {
    const season =
      (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
      (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));
    const r = await reconcileFromCsv(text, season?.id ?? null);
    const params = new URLSearchParams({
      csvok: "1",
      rows: String(r.paidRows),
      byid: String(r.markedById),
      byemail: String(r.markedByEmail),
      created: String(r.createdAttributed),
      unatt: String(r.createdUnattributed),
      already: String(r.alreadyDone),
      failed: String(r.skippedFailed),
      applied: String(r.appliedCents),
    });
    if (r.errors) params.set("csverrs", String(r.errors));
    return back(`?${params.toString()}`);
  } catch (e) {
    console.error("CSV reconcile failed", e);
    return back(`?csverr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "failed")}`);
  }
}
