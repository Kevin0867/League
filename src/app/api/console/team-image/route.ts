import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { uploadImage } from "@/lib/upload";

// Team photo upload (multipart). Admins, or the team's own head/assistant coach.
// The photo only appears publicly when every player has media consent — that
// gate is enforced at render time on the public team page.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const teamId = String(fd.get("teamId") ?? "");
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/teams/${teamId}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?imgerr=auth");
  if (!teamId) return NextResponse.redirect(new URL("/console/teams", origin), 303);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { coach: { select: { id: true } }, assistantCoaches: { select: { coachId: true } } },
  });
  if (!team) return back("?imgerr=notfound");

  let allowed = can(actor.roles, "manageTeams");
  if (!allowed) {
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
    const myCoach = me?.personId ? await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } }) : null;
    allowed = !!myCoach && (team.coachId === myCoach.id || team.assistantCoaches.some((tc) => tc.coachId === myCoach.id));
  }
  if (!allowed) return back("?imgerr=auth");

  const file = fd.get("file");
  if (!(file instanceof File)) return back("?imgerr=" + encodeURIComponent("Choose an image to upload."));

  const res = await uploadImage(file, `teams/${teamId}`);
  if (!res.ok) return back("?imgerr=" + encodeURIComponent(res.error));

  await prisma.team.update({ where: { id: teamId }, data: { photoUrl: res.url } });
  await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "team.photo", summary: "Uploaded team photo" });
  return back("?imgok=team");
}
