import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { teamUpdateEmail } from "@/lib/domain/teamUpdateEmail";

// Coach/admin team broadcast: a note sent to the whole team (players + parents).
// Authorized for admins, or the team's own head/assistant coach.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  const teamId = String(fd.get("teamId") ?? "");
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/teams/${teamId}/progress${qs}`, origin), 303);

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
  if (!body) return back("?err=empty");
  const alsoText = fd.get("channel_SMS") === "on";

  const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "Your PURE coach";
  const email = teamUpdateEmail({ teamName: team.name, coachName, body });
  const res = await dispatchMessage({
    senderId: actor.userId,
    seasonId: team.seasonId,
    audienceType: "TEAM",
    audienceRef: teamId,
    channels: alsoText ? ["IN_APP", "EMAIL", "SMS"] : ["IN_APP", "EMAIL"],
    triggerType: "TEAM_UPDATE",
    subject: email.subject,
    body: email.text,
    html: email.html,
    // The email body is long-form; the SMS gets the coach's raw note prefixed
    // with the team name so it reads cleanly as a text.
    smsBody: `${team.name} update from ${coachName}:\n${body}`,
  });

  await audit({
    actorId: actor.userId,
    entityType: "Team",
    entityId: teamId,
    action: "team.update",
    summary: `Team update sent to ${res.recipients} recipient(s)${res.failures ? `, ${res.failures} failed` : ""}`,
  });

  const qs = new URLSearchParams({ ok: "teamsent", n: String(res.recipients) });
  if (res.failures) qs.set("failed", String(res.failures));
  if (res.failureReasons[0]) qs.set("reason", res.failureReasons[0].slice(0, 160));
  return back(`?${qs.toString()}`);
}
