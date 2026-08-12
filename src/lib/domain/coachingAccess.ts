import "server-only";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

// Server-side view gate for coaching notes: admins see every team; a coach sees
// only teams they head or assist. Mirrors authorizeTeamNotes in the API route.
export async function canViewTeamNotes(teamId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  if (can(session.roles ?? [session.role], "manageTeams")) return true;
  if (!session.personId) return false;
  const coach = await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true } });
  if (!coach) return false;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { coachId: true, assistantCoaches: { select: { coachId: true } } },
  });
  if (!team) return false;
  return team.coachId === coach.id || team.assistantCoaches.some((tc) => tc.coachId === coach.id);
}
