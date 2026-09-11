import { isAdmin } from "@/lib/rbac";
import type { Role } from "@/lib/enums";
import { prisma } from "@/lib/db";

type SessionLike = { role: Role; roles?: Role[]; personId?: string | null };

// Teams a staff member may fill out coaching forms for: admins see every
// active non-test team; a coach sees the active teams they head- or
// assistant-coach. Shared by every coaching-form page.
export async function formTeamOptions(session: SessionLike): Promise<{ id: string; name: string }[]> {
  const admin = isAdmin(session.roles ?? [session.role]);
  if (admin) {
    return prisma.team.findMany({ where: { isTest: false, season: { active: true } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }
  const coach = session.personId
    ? await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true } })
    : null;
  if (!coach) return [];
  return prisma.team.findMany({
    where: { season: { active: true }, OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
