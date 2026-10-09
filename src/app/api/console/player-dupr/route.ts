import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Set a PLAYER's DUPR rating. Players never enter their own rating — only an
// admin (manageTeams) or a COACH of a team the player is on may. Native-form
// POST + ticket auth, 303 back to the team page.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const teamId = g("teamId");
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/teams/${teamId}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  const personId = g("personId");
  if (!teamId || !personId) return back("?err=dupr");

  // Authorize: admin, or this team's head/assistant coach.
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { coachId: true, assistantCoaches: { select: { coachId: true } } },
  });
  if (!team) return back("?err=dupr");
  let allowed = can(actor.roles ?? [actor.role], "manageTeams");
  if (!allowed) {
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
    const myCoach = me?.personId ? await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } }) : null;
    allowed = !!myCoach && (team.coachId === myCoach.id || team.assistantCoaches.some((tc) => tc.coachId === myCoach.id));
  }
  if (!allowed) return back("?err=duprauth");

  // The player must actually be on this team — a coach can only rate their roster.
  const member = await prisma.teamMember.findFirst({ where: { teamId, personId }, select: { id: true } });
  if (!member) return back("?err=dupr");

  // Validate the rating (2.0–8.0, up to 3 decimals; blank clears it).
  const drStr = g("duprRating");
  let duprRating: number | null;
  if (drStr === "") {
    duprRating = null;
  } else {
    const dr = parseFloat(drStr);
    if (!Number.isFinite(dr) || dr < 2 || dr > 8) return back("?err=dupr");
    duprRating = Math.round(dr * 1000) / 1000;
  }
  const duprId = g("duprId") || null;

  await prisma.person.update({ where: { id: personId }, data: { duprRating, duprId } });
  await audit({
    actorId: actor.userId, entityType: "Person", entityId: personId, action: "player.dupr.set",
    summary: `Set DUPR rating to ${duprRating ?? "—"}${duprId ? ` (id ${duprId})` : ""}`,
  });
  return back("?ok=dupr");
}
