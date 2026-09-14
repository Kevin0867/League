import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { ensureTeamConversation } from "@/lib/domain/teamThread";
import { appendMessage } from "@/lib/domain/dm";

// Coach/admin team broadcast: a note sent to the whole team (players + parents).
// Authorized for admins, or the team's own head/assistant coach.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  const teamId = String(fd.get("teamId") ?? "");
  // By default we land on the team's progress page; a caller (e.g. the training
  // library) can pass returnTo to come back to where they shared from.
  const rawReturn = String(fd.get("returnTo") ?? "");
  const dest = rawReturn.startsWith("/console/") ? rawReturn.split("?")[0].split("#")[0] : `/console/teams/${teamId}/progress`;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`${dest}${qs}`, origin), 303);

  if (!actor) return back("?err=auth");
  if (String(fd.get("op")) !== "broadcastTeam") return back("?err=op");

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { coach: { include: { person: true } }, assistantCoaches: { select: { coachId: true } } },
  });
  if (!team) return NextResponse.redirect(new URL("/console/teams", origin), 303);

  // Admins pass; otherwise the actor must be this team's head/assistant coach.
  let allowed = can(actor.roles, "manageTeams");
  if (!allowed) {
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
    const myCoach = me?.personId
      ? await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } })
      : null;
    allowed = !!myCoach && (team.coachId === myCoach.id || team.assistantCoaches.some((tc) => tc.coachId === myCoach.id));
  }
  if (!allowed) return back("?err=auth");

  const body = String(fd.get("body") ?? "").trim();
  const attachmentUrl = String(fd.get("attachmentUrl") ?? "").trim() || null;
  const attachmentType = String(fd.get("attachmentType") ?? "").trim() || null;
  if (!body && !attachmentUrl) return back("?err=empty");

  // Post the coach's update into the team's group thread — so it reaches the
  // whole team (players + parents) AND everyone can reply in one place. Replaces
  // the old one-way team broadcast; appendMessage notifies every participant by
  // email + text.
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  if (!me?.personId) return back("?err=auth");
  const conversationId = await ensureTeamConversation(teamId);
  if (!conversationId) return back("?err=empty");
  const attach = attachmentUrl ? { url: attachmentUrl, type: attachmentType } : null;
  await appendMessage(conversationId, me.personId, body, { email: true, sms: true }, attach);

  await audit({
    actorId: actor.userId,
    entityType: "Team",
    entityId: teamId,
    action: "team.update",
    summary: `Posted a team update to the ${team.name} team thread`,
  });

  // Land the coach in the thread so they see it posted and any replies.
  return NextResponse.redirect(new URL(`/console/inbox/${conversationId}`, origin), 303);
}
