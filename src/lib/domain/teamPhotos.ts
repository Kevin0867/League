import "server-only";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/rbac";
import type { Role } from "@/lib/enums";
import { teamDisplayName, teamSlug } from "@/lib/domain/teamName";
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
  onWebsite: boolean;
  onTeamPage: boolean;
  createdAt: Date;
};

export async function listTeamPhotos(teamId: string): Promise<TeamPhotoItem[]> {
  return prisma.teamPhoto.findMany({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, type: true, caption: true, uploaderId: true, uploaderName: true, onWebsite: true, onTeamPage: true, createdAt: true },
  });
}

/** How many team gallery items were added since the admin last reviewed them —
 *  drives the "new uploads to review" nav badge. Null `since` (never reviewed)
 *  counts everything. */
export async function newTeamPhotoCount(since: Date | null | undefined): Promise<number> {
  return prisma.teamPhoto.count({ where: since ? { createdAt: { gt: since } } : {} });
}

/** Stamp the admin's last-reviewed time to now (called when they open the Team
 *  Photos page) so the nav badge clears. Returns whether there was anything new
 *  (so the caller can refresh the layout badge). */
export async function markPhotosReviewed(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { photosReviewedAt: true } });
  const had = (await newTeamPhotoCount(user?.photosReviewedAt ?? null)) > 0;
  await prisma.user.update({ where: { id: userId }, data: { photosReviewedAt: new Date() } });
  return had;
}

export type AdminGalleryItem = TeamPhotoItem & { teamId: string; teamName: string };

/** Every team gallery item across all teams, newest first — the admin review
 *  queue for what players and coaches have added, where they get published to
 *  the public site. */
export async function listAllTeamPhotos(limit = 400): Promise<AdminGalleryItem[]> {
  const rows = await prisma.teamPhoto.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, url: true, type: true, caption: true, uploaderId: true, uploaderName: true,
      onWebsite: true, onTeamPage: true, createdAt: true, teamId: true,
      team: { select: { name: true, club: true, market: true, divisionCode: true, color: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, url: r.url, type: r.type, caption: r.caption, uploaderId: r.uploaderId, uploaderName: r.uploaderName,
    onWebsite: r.onWebsite, onTeamPage: r.onTeamPage, createdAt: r.createdAt,
    teamId: r.teamId, teamName: r.team ? teamDisplayName(r.team) : "Team",
  }));
}

/** Items a team has published to its public page. */
export async function listTeamPagePhotos(teamId: string): Promise<TeamPhotoItem[]> {
  return prisma.teamPhoto.findMany({
    where: { teamId, onTeamPage: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, type: true, caption: true, uploaderId: true, uploaderName: true, onWebsite: true, onTeamPage: true, createdAt: true },
  });
}

export type GalleryItem = TeamPhotoItem & { teamName: string; teamSlug: string | null };

/** All items published to the public site gallery, newest first. The team link
 *  is only set for a published PURE team (whose public /teams/[slug] page
 *  exists); its slug is derived from identity parts, not stored. */
export async function listWebsiteGallery(limit = 200): Promise<GalleryItem[]> {
  const rows = await prisma.teamPhoto.findMany({
    where: { onWebsite: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, url: true, type: true, caption: true, uploaderId: true, uploaderName: true,
      onWebsite: true, onTeamPage: true, createdAt: true,
      team: { select: { name: true, club: true, market: true, divisionCode: true, color: true, published: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, url: r.url, type: r.type, caption: r.caption, uploaderId: r.uploaderId, uploaderName: r.uploaderName,
    onWebsite: r.onWebsite, onTeamPage: r.onTeamPage, createdAt: r.createdAt,
    teamName: r.team ? teamDisplayName(r.team) : "PURE Academy",
    teamSlug: r.team && r.team.published && (r.team.club ?? "PURE") === "PURE" ? teamSlug(r.team) : null,
  }));
}
