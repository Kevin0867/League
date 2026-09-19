import "server-only";
import { prisma } from "@/lib/db";
import { dispatchMessage } from "@/lib/messaging";
import { teamAssignmentEmail } from "@/lib/domain/assignmentEmail";
import { placementPayLink } from "@/lib/payments/familyFee";
import { placementWaiverLink } from "@/lib/domain/waiverRenewal";
import { describeTeamPractice } from "@/lib/domain/practiceInfo";

// Send a player the details of the team they've been placed on / moved to:
// team name, coach + contact, location, practice day/time, plus their pay and
// waiver links. Used on a MOVE between teams (a first placement gets the fuller
// sendTeamLaunch welcome instead). Email + in-app by default.
export async function notifyTeamAssignment(
  teamId: string,
  personId: string,
  seasonId: string,
  opts?: { emailOnly?: boolean },
): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { facility: true, coach: { include: { person: true } }, members: { include: { person: true } } },
  });
  if (!team) return;
  const person = team.members.find((m) => m.personId === personId)?.person;
  const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
  const coachContact = [team.coach?.person.email, team.coach?.person.phone].filter(Boolean).join(" · ") || null;
  const pay = await placementPayLink(personId, seasonId);
  const waiver = await placementWaiverLink(personId);
  const practiceWhen = await describeTeamPractice(team, seasonId);
  const email = teamAssignmentEmail({
    name: person?.firstName ?? "there",
    teamId: team.id,
    teamName: team.name,
    coachName,
    coachContact,
    locationName: team.facility?.name ?? "To be confirmed",
    locationAddress: team.facility?.exactAddress ?? team.facility?.generalArea ?? null,
    practiceWhen,
    payUrl: pay?.payUrl ?? null,
    feeCents: pay?.feeCents ?? null,
    waiverUrl: waiver.waiverUrl,
  });
  await dispatchMessage({
    seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
    channels: opts?.emailOnly ? ["EMAIL"] : ["IN_APP", "EMAIL"], triggerType: "TEAM_ASSIGNMENT",
    subject: email.subject, body: email.text, html: email.html,
  });
}
