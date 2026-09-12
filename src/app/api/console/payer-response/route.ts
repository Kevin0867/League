import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Mark a pay-page reply handled (or reopen it). Admin-only. Keyed by the
// PAYER_RESPONSE audit entry id.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/payments${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isAdmin(actor.roles)) return back("?err=auth");

  const responseId = String(fd.get("responseId") ?? "").trim();
  const op = String(fd.get("op") ?? "resolve");
  if (!responseId) return back("");

  if (op === "reopen") {
    await prisma.payerResponseResolution.deleteMany({ where: { auditLogId: responseId } });
    await audit({ actorId: actor.userId, entityType: "AuditLog", entityId: responseId, action: "PAYER_RESPONSE_REOPENED", summary: "Reopened pay-page reply" });
    return back("?resp=reopened");
  }

  await prisma.payerResponseResolution.upsert({
    where: { auditLogId: responseId },
    create: { auditLogId: responseId, resolvedById: actor.userId },
    update: { resolvedById: actor.userId, resolvedAt: new Date() },
  });
  await audit({ actorId: actor.userId, entityType: "AuditLog", entityId: responseId, action: "PAYER_RESPONSE_RESOLVED", summary: "Resolved pay-page reply" });
  return back("?resp=resolved");
}
