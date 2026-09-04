import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { reconcileFromCsv } from "@/lib/payments/csvReconcile";
import { undoCsvImport } from "@/lib/payments/reconcile";

// Exact reconciliation from an uploaded Stripe "unified payments" CSV. Native
// multipart POST (carries the session cookie reliably on this runtime). Gated
// to runPayouts like the other reconcile actions.
export const dynamic = "force-dynamic";
// A full-season Stripe export is a few hundred rows; give the reconcile room so
// it never times out mid-file on a slower database connection.
export const maxDuration = 300;

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/payments${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "runPayouts")) return back("?err=auth");

  // Cleanup: remove rows the CSV reconciler CREATED in earlier versions (the
  // full-charge dupes that inflated Collected). Leaves webhook-recorded fees.
  if (String(fd.get("op") ?? "") === "undo-csv") {
    try {
      const u = await undoCsvImport();
      return back(`?csvundo=1&removed=${u.removed}&remcents=${u.removedCents}`);
    } catch (e) {
      console.error("undo CSV import failed", e);
      return back(`?csverr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "undo failed")}`);
    }
  }

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
      byname: String(r.markedByName),
      byemail: String(r.markedByEmail),
      subsset: String(r.subscriptionsSet),
      created: String(r.createdAttributed),
      noperson: String(r.noPersonMatch),
      already: String(r.alreadyDone),
      failed: String(r.skippedFailed),
      applied: String(r.appliedCents),
    });
    if (r.errors) {
      params.set("csverrs", String(r.errors));
      if (r.problems[0]) params.set("csvprob", `${r.problems[0].note} (${r.problems[0].chargeId})`.slice(0, 200));
    }
    return back(`?${params.toString()}`);
  } catch (e) {
    console.error("CSV reconcile failed", e);
    return back(`?csverr=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "failed")}`);
  }
}
