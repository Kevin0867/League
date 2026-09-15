import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { teamPhotoAccess, canDeleteTeamPhoto } from "@/lib/domain/teamPhotos";

// Add / remove a photo or video in a team's shared gallery. Native-form POSTs
// with ticket auth, used from both the console (coach/admin) and the family
// portal (player/parent). The file is uploaded straight to Blob client-side;
// the form carries its URL + kind. Access is checked against the team: a member
// of the team's household, a coach of it, or an admin.
export const dynamic = "force-dynamic";

/** The person ids that count as "me" for membership — the actor plus any
 *  dependents they manage (a parent uploading for their player's team). */
async function householdOf(personId: string | null): Promise<string[]> {
  if (!personId) return [];
  const deps = await prisma.person.findMany({ where: { guardianId: personId }, select: { id: true } });
  return [personId, ...deps.map((d) => d.id)];
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const teamId = String(fd.get("teamId") ?? "").trim();

  // Bounce back to wherever the form was (portal team page or console team page).
  const rawReturn = String(fd.get("returnTo") ?? "");
  const fallback = teamId ? `/console/teams/${teamId}` : "/console/teams";
  const dest = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : fallback;
  const back = (qs: string) => NextResponse.redirect(new URL(`${dest}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");
  if (!teamId) return back("?err=fields");

  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const household = await householdOf(me?.personId ?? null);
  const access = await teamPhotoAccess(actor.userId, actor.roles, teamId, household);

  if (op === "add") {
    if (!access.canPost) return back("?err=perm");
    const url = String(fd.get("attachmentUrl") ?? "").trim();
    const type = String(fd.get("attachmentType") ?? "").trim().toUpperCase() === "VIDEO" ? "VIDEO" : "IMAGE";
    const caption = String(fd.get("caption") ?? "").trim().slice(0, 300) || null;
    if (!url) return back("?err=nofile");

    const uploaderName = access.personId
      ? (await prisma.person.findUnique({ where: { id: access.personId }, select: { firstName: true, lastName: true } }))
      : null;
    await prisma.teamPhoto.create({
      data: {
        teamId,
        uploaderId: access.personId,
        uploaderName: uploaderName ? `${uploaderName.firstName} ${uploaderName.lastName}`.trim() : null,
        url,
        type,
        caption,
      },
    });
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "teamphoto.add", summary: `Added a ${type === "VIDEO" ? "video" : "photo"} to the team gallery` });
    return back("?tp=added#team-photos");
  }

  // Toggle a publish flag (show on the public site gallery / the team's public
  // page). Staff-only: coaches of the team and admins curate what goes public.
  if (op === "setPublish") {
    if (!(access.isCoach || access.admin)) return back("?err=perm");
    const photoId = String(fd.get("photoId") ?? "").trim();
    const field = String(fd.get("field") ?? "").trim();
    if (!photoId || (field !== "onWebsite" && field !== "onTeamPage")) return back("?err=fields");
    const photo = await prisma.teamPhoto.findUnique({ where: { id: photoId }, select: { id: true, teamId: true } });
    if (!photo || photo.teamId !== teamId) return back("?err=notfound");
    const value = fd.get("value") === "1";
    await prisma.teamPhoto.update({ where: { id: photo.id }, data: { [field]: value } });
    return back("#team-photos");
  }

  if (op === "delete") {
    const photoId = String(fd.get("photoId") ?? "").trim();
    if (!photoId) return back("?err=fields");
    const photo = await prisma.teamPhoto.findUnique({ where: { id: photoId }, select: { id: true, teamId: true, uploaderId: true } });
    if (!photo || photo.teamId !== teamId) return back("?err=notfound");
    if (!(await canDeleteTeamPhoto(actor.userId, actor.roles, photo, access.personId))) return back("?err=perm");
    await prisma.teamPhoto.delete({ where: { id: photo.id } });
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "teamphoto.delete", summary: "Removed a team gallery item" });
    return back("?tp=deleted#team-photos");
  }

  return back("?err=op");
}
