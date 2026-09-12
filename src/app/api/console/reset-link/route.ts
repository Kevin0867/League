import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { sendResetLinkForPerson } from "@/lib/domain/passwordResetSend";

// Admin action: send a set/reset-password link to a person (or, for a minor
// without their own contact info, to their guardian) by email + text. Usable
// from anywhere a person is shown — Access, Registrations, Teams.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const rawReturn = String(fd.get("returnTo") ?? "/console");
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/console";
  const sep = returnTo.includes("?") ? "&" : "?";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${sep}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isAdmin(actor.roles)) return back("reset=auth");

  // Accept a personId directly, or a userId (resolve to its person).
  let personId = String(fd.get("personId") ?? "").trim();
  const userId = String(fd.get("userId") ?? "").trim();
  if (!personId && userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { personId: true } });
    personId = u?.personId ?? "";
  }
  if (!personId) return back("reset=notarget");

  const res = await sendResetLinkForPerson(personId);
  if (!res.ok) return back(`reset=${res.reason}`);
  await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "user.resetLinkSent", summary: `Sent password reset link to ${res.toName}${res.viaGuardian ? " (guardian)" : ""}` });
  return back(`reset=sent&resetVia=${res.viaGuardian ? "guardian" : "self"}`);
}
