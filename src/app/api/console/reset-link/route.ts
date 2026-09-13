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

  // Bulk: send portal access to every registered player who can't log in yet
  // (in the active season). Only those with an email are sent (a login needs one).
  if (String(fd.get("op") ?? "") === "sendAllNoAccess") {
    const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" }, select: { id: true } })
      ?? await prisma.season.findFirst({ where: { active: true }, orderBy: { startDate: "desc" }, select: { id: true } });
    if (!season) return back("reset=notarget");
    const { playersWithoutPortalAccess } = await import("@/lib/domain/portalAccess");
    const players = (await playersWithoutPortalAccess(season.id)).filter((p) => p.hasEmail);
    let sent = 0;
    for (const p of players) {
      const res = await sendResetLinkForPerson(p.personId);
      if (res.ok) sent++;
    }
    await audit({ actorId: actor.userId, entityType: "Season", entityId: season.id, action: "portal.bulkAccess", summary: `Sent portal access to ${sent} player(s) without a login` });
    return back(`reset=bulk&n=${sent}`);
  }

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
  await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: res.created ? "user.inviteSent" : "user.resetLinkSent", summary: `${res.created ? "Created login + sent set-password link" : "Sent password reset link"} to ${res.toName}${res.viaGuardian ? " (guardian)" : ""}` });
  return back(`reset=sent&resetVia=${res.viaGuardian ? "guardian" : "self"}${res.created ? "&resetNew=1" : ""}`);
}
