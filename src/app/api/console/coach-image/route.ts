import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { uploadImage } from "@/lib/upload";

// Profile-photo upload (multipart) → person.imageUrl. Serves several cases,
// each with its own authorization:
//   • a coach or player uploading their OWN photo (portal or console),
//   • a PARENT uploading one of their household players' photos,
//   • an ADMIN uploading for anyone,
//   • a TEAM COACH photographing a player on a team they coach.
// Ticket-authenticated like the other console mutations; returns to /console or
// /portal (whichever the caller came from).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const rawReturn = String(fd.get("returnTo") ?? "");
  const returnTo = rawReturn.startsWith("/console") || rawReturn.startsWith("/portal") ? rawReturn : "/console/profile";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?imgerr=auth");

  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const requested = String(fd.get("personId") ?? "");
  const personId = requested || me?.personId || "";
  if (!personId) return back("?imgerr=auth");

  const editingOther = personId !== me?.personId;
  if (editingOther && !isAdmin(actor.role)) {
    // Not an admin — allow only a parent (their own household player) or the
    // coach of a team the target player is on.
    let ok = false;
    const target = await prisma.person.findUnique({ where: { id: personId }, select: { guardianId: true } });
    if (target?.guardianId && target.guardianId === me?.personId) ok = true;
    if (!ok && me?.personId) {
      const myCoach = await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } });
      if (myCoach) {
        const onMyTeam = await prisma.teamMember.findFirst({
          where: { personId, team: { OR: [{ coachId: myCoach.id }, { assistantCoaches: { some: { coachId: myCoach.id } } }] } },
          select: { id: true },
        });
        ok = !!onMyTeam;
      }
    }
    if (!ok) return back("?imgerr=auth");
  }

  const file = fd.get("file");
  if (!(file instanceof File)) return back("?imgerr=" + encodeURIComponent("Choose an image to upload."));

  const res = await uploadImage(file, `coaches/${personId}`);
  if (!res.ok) return back("?imgerr=" + encodeURIComponent(res.error));

  await prisma.person.update({ where: { id: personId }, data: { imageUrl: res.url } });
  await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "person.image", summary: "Uploaded profile image" });
  return back("?imgok=1");
}
