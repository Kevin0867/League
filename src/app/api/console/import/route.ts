import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, verifyActionTicket } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { previewEnrollments, runEnrollmentImport } from "@/lib/domain/runEnrollmentImport";

// Enrollment import as a route handler driven by a NATIVE form POST. On this
// deployment the session cookie is delivered on GET navigations but NOT on
// POSTs to route handlers, so we authorize off a short-lived signed ticket
// minted while rendering the page and carried in the form body. The actual
// import work lives in runEnrollmentImport so the CLI/CI script stays in sync.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/import?${qs}`, origin), 303);

  const formData = await req.formData();

  // Authorize off the signed action ticket carried in the form body (the
  // session cookie is not delivered on POSTs here), falling back to the cookie
  // session if it happens to be present.
  const ticket = await verifyActionTicket(formData.get("ticket")?.toString(), "console.import");
  const session = ticket ?? (await getSession());
  if (!session) return back("err=auth");
  if (!["COO", "DIRECTOR"].includes(session.role)) return back("err=role");
  const actorId = "userId" in session ? session.userId : "";

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return back("err=file");

  const text = await file.text();
  const pv = previewEnrollments(text);
  if (pv.mapped === 0) return back("err=empty");

  if (formData.get("mode") !== "commit") {
    const p = new URLSearchParams({
      preview: "1",
      total: String(pv.total),
      mapped: String(pv.mapped),
      skipped: String(pv.skipped),
      child: String(pv.child),
      divc: String(pv.divisions),
      markets: pv.markets.join(","),
    });
    return back(p.toString());
  }

  // --- Commit ---
  const result = await runEnrollmentImport(prisma, text);

  await audit({
    actorId,
    entityType: "Season",
    entityId: "",
    action: "enrollments.import",
    summary: `Imported ${result.created} new / ${result.duplicates} duplicate registrations from CSV`,
  });

  const p = new URLSearchParams({
    done: "1",
    created: String(result.created),
    dup: String(result.duplicates),
    div: String(result.divisionsAdded),
    err: String(result.errors),
    season: result.seasonName,
  });
  return back(p.toString());
}
