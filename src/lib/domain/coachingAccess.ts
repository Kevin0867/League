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

/** Team ids a given USER (by userId) heads or assists. Empty if not a coach.
 *  Used by API routes that authorize from the form ticket (actor.userId). */
export async function coachedTeamIdsForUser(userId: string): Promise<string[]> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { personId: true } });
  if (!me?.personId) return [];
  const coach = await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } });
  if (!coach) return [];
  const teams = await prisma.team.findMany({
    where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
    select: { id: true },
  });
  return teams.map((t) => t.id);
}

/** Team ids the CURRENT session's user heads or assists. Empty if not signed in
 *  or not a coach. Used by server components to scope what a coach can act on. */
export async function coachedTeamIds(): Promise<string[]> {
  const session = await getSession();
  if (!session?.personId) return [];
  const coach = await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true } });
  if (!coach) return [];
  const teams = await prisma.team.findMany({
    where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
    select: { id: true },
  });
  return teams.map((t) => t.id);
}
