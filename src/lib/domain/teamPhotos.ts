import "server-only";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/rbac";
import type { Role } from "@/lib/enums";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";

// Team photo/video gallery access. Anyone connected to a team — a rostered
// player, a parent in that player's household, a coach of the team, or an admin
// — may view and add to its gallery. A photo can be removed by whoever added it,
// a coach of that team, or an admin.

export type TeamPhotoAccess = {
  personId: string | null;
  isMember: boolean;
  isCoach: boolean;
  admin: boolean;
  canView: boolean;
  canPost: boolean;
};

/** Resolve what a signed-in user may do with a team's gallery. `householdIds`
 *  are the person ids that count as "me" (the account holder + dependents). */
export async function teamPhotoAccess(
  userId: string,
  role: Role | Role[],
  teamId: string,
  householdIds: string[],
): Promise<TeamPhotoAccess> {
  const admin = isAdmin(role);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { personId: true } });
  const personId = me?.personId ?? null;

  const isMember = householdIds.length
    ? (await prisma.teamMember.count({ where: { teamId, personId: { in: householdIds } } })) > 0
    : false;
  const isCoach = admin ? true : (await coachedTeamIdsForUser(userId)).includes(teamId);

  const canView = admin || isCoach || isMember;
  return { personId, isMember, isCoach, admin, canView, canPost: canView };
}

/** May this user delete this specific photo? Uploader, a coach of the team, or
 *  an admin. */
export async function canDeleteTeamPhoto(
  userId: string,
  role: Role | Role[],
  photo: { teamId: string; uploaderId: string | null },
  personId: string | null,
): Promise<boolean> {
  if (isAdmin(role)) return true;
  if (personId && photo.uploaderId && photo.uploaderId === personId) return true;
  return (await coachedTeamIdsForUser(userId)).includes(photo.teamId);
}

export type TeamPhotoItem = {
  id: string;
  url: string;
  type: string;
  caption: string | null;
  uploaderId: string | null;
  uploaderName: string | null;
  createdAt: Date;
};

export async function listTeamPhotos(teamId: string): Promise<TeamPhotoItem[]> {
  return prisma.teamPhoto.findMany({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, type: true, caption: true, uploaderId: true, uploaderName: true, createdAt: true },
  });
}
