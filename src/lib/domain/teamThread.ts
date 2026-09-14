import "server-only";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/enums";

// Group conversations: a persistent thread per team (coach + all players), and a
// per-member thread with the admin team. Both reuse the 1:1 DM primitives
// (Conversation / ConversationParticipant / ChatMessage) — a group is just a
// conversation with many participants.

async function teamThreadMemberIds(teamId: string): Promise<string[]> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      coach: { select: { personId: true } },
      assistantCoaches: { select: { coach: { select: { personId: true } } } },
      members: { select: { personId: true } },
    },
  });
  if (!team) return [];
  const ids = new Set<string>();
  if (team.coach?.personId) ids.add(team.coach.personId);
  for (const ac of team.assistantCoaches) if (ac.coach?.personId) ids.add(ac.coach.personId);
  for (const m of team.members) ids.add(m.personId);
  return [...ids];
}

async function addParticipants(conversationId: string, personIds: string[]): Promise<void> {
  const existing = new Set(
    (await prisma.conversationParticipant.findMany({ where: { conversationId }, select: { personId: true } })).map((p) => p.personId),
  );
  const toAdd = personIds.filter((id) => !existing.has(id));
  if (toAdd.length) {
    await prisma.conversationParticipant.createMany({
      data: toAdd.map((personId) => ({ conversationId, personId })),
      skipDuplicates: true,
    });
  }
}

/** Get or create a team's group thread, syncing in any new roster members and
 *  coaches. Existing participants are kept (preserves history + read state). */
export async function ensureTeamConversation(teamId: string): Promise<string | null> {
  const memberIds = await teamThreadMemberIds(teamId);
  if (memberIds.length === 0) return null;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  const existing = await prisma.conversation.findFirst({ where: { teamId, kind: "TEAM" }, select: { id: true } });
  if (existing) {
    await addParticipants(existing.id, memberIds);
    return existing.id;
  }
  const created = await prisma.conversation.create({
    data: {
      kind: "TEAM",
      teamId,
      subject: team?.name ? `${team.name} — team chat` : "Team chat",
      participants: { create: memberIds.map((personId) => ({ personId })) },
    },
    select: { id: true },
  });
  return created.id;
}

async function adminPersonIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { active: true, personId: { not: null }, role: { in: ADMIN_ROLES as unknown as string[] } },
    select: { personId: true },
  });
  return admins.map((a) => a.personId!).filter(Boolean);
}

/** Get or create a member's thread with the admin team (a group of the member +
 *  all admins), so "message Admins" reaches whoever is on staff. */
export async function ensureAdminConversation(personId: string): Promise<string | null> {
  const admins = await adminPersonIds();
  const others = admins.filter((id) => id !== personId);
  if (others.length === 0) return null;
  const existing = await prisma.conversation.findFirst({
    where: { kind: "ADMINS", participants: { some: { personId } } },
    select: { id: true },
  });
  if (existing) {
    await addParticipants(existing.id, [personId, ...others]);
    return existing.id;
  }
  const created = await prisma.conversation.create({
    data: {
      kind: "ADMINS",
      subject: "Message to PURE Academy admins",
      participants: { create: [personId, ...others].map((pid) => ({ personId: pid })) },
    },
    select: { id: true },
  });
  return created.id;
}
