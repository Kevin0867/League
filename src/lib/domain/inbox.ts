import "server-only";
import { prisma } from "@/lib/db";

// How many direct-message threads have a message this person hasn't read yet —
// used for the "you have unread messages" banner + nav badge so a new message is
// never missed. A thread counts as unread when it holds a message from someone
// else, newer than this person's lastReadAt, and they haven't archived it.
async function unreadInboxThreads(personId: string): Promise<{ id: string; lastMessageAt: Date }[]> {
  const parts = await prisma.conversationParticipant.findMany({
    where: { personId, hiddenAt: null },
    select: { conversationId: true, lastReadAt: true, conversation: { select: { lastMessageAt: true } } },
  });
  if (!parts.length) return [];
  const convIds = parts.map((p) => p.conversationId);
  const msgs = await prisma.chatMessage.findMany({
    where: { conversationId: { in: convIds }, deletedAt: null, senderId: { not: personId } },
    select: { conversationId: true, createdAt: true },
  });
  const lastReadByConv = new Map(parts.map((p) => [p.conversationId, p.lastReadAt]));
  const lastMsgByConv = new Map(parts.map((p) => [p.conversationId, p.conversation.lastMessageAt]));
  const unread = new Set<string>();
  for (const m of msgs) {
    const lr = lastReadByConv.get(m.conversationId);
    if (!lr || m.createdAt > lr) unread.add(m.conversationId);
  }
  return [...unread]
    .map((id) => ({ id, lastMessageAt: lastMsgByConv.get(id) ?? new Date(0) }))
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
}

export async function unreadInboxCount(personId: string | null | undefined): Promise<number> {
  if (!personId) return 0;
  return (await unreadInboxThreads(personId)).length;
}

/** The id of the most recent unread thread — so a banner can link straight to
 *  the conversation to read (which marks it read), instead of the list. */
export async function firstUnreadInboxId(personId: string | null | undefined): Promise<string | null> {
  if (!personId) return null;
  const t = await unreadInboxThreads(personId);
  return t[0]?.id ?? null;
}

// Unread broadcast/announcement messages this person received in-app (readAt
// null). Drives the "Announcements" banner + badge so a coach/admin sees a new
// announcement, not just families. Counts IN_APP messages only — email/SMS-only
// sends never clutter the in-app list.
export async function unreadBroadcastCount(personId: string | null | undefined): Promise<number> {
  if (!personId) return 0;
  return prisma.messageRecipient.count({
    where: { personId, readAt: null, message: { channels: { contains: "IN_APP" } } },
  });
}
