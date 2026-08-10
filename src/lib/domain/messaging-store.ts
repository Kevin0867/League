import "server-only";
import { prisma } from "@/lib/db";

// Read helpers for the direct-messaging inbox and thread views. Retention rule:
// a message with deletedAt or a thread a user has hidden is still returned to a
// moderator (admin) — only the participant's own view hides it.

export type InboxItem = {
  id: string;
  subject: string | null;
  others: string; // other participants' names, comma-joined
  preview: string;
  lastMessageAt: Date;
  unread: boolean;
};

function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`;
}

/** Conversations the person participates in (hidden ones excluded). */
export async function inboxItems(personId: string): Promise<InboxItem[]> {
  const parts = await prisma.conversationParticipant.findMany({
    where: { personId, hiddenAt: null },
    select: {
      lastReadAt: true,
      conversation: {
        select: {
          id: true,
          subject: true,
          lastMessageAt: true,
          participants: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, deletedAt: true, senderId: true, createdAt: true },
          },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
  });

  return parts.map((p) => {
    const c = p.conversation;
    const others = c.participants.filter((pt) => pt.personId !== personId).map((pt) => fullName(pt.person)).join(", ");
    const last = c.messages[0];
    const preview = !last ? "No messages yet" : last.deletedAt ? "Message deleted" : last.body;
    const unread = !!last && last.senderId !== personId && (!p.lastReadAt || last.createdAt > p.lastReadAt);
    return { id: c.id, subject: c.subject, others: others || "(no one)", preview, lastMessageAt: c.lastMessageAt, unread };
  });
}

/** Every conversation, for the admin moderation view. */
export async function moderationItems(): Promise<InboxItem[]> {
  const convos = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    select: {
      id: true,
      subject: true,
      lastMessageAt: true,
      participants: { select: { person: { select: { firstName: true, lastName: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, deletedAt: true } },
    },
  });
  return convos.map((c) => {
    const last = c.messages[0];
    return {
      id: c.id,
      subject: c.subject,
      others: c.participants.map((pt) => fullName(pt.person)).join(" ↔ ") || "(no one)",
      preview: !last ? "No messages yet" : last.deletedAt ? "Message deleted (retained)" : last.body,
      lastMessageAt: c.lastMessageAt,
      unread: false,
    };
  });
}

export type ThreadMessage = {
  id: string;
  body: string;
  createdAt: Date;
  deleted: boolean;
  mine: boolean;
  senderName: string;
};

export type Thread = {
  id: string;
  subject: string | null;
  participantIds: string[];
  others: string;
  messages: ThreadMessage[];
};

/**
 * A single conversation. Returns null if the viewer is neither a participant nor
 * a moderator. Moderators see deleted messages (flagged); participants see a
 * "message deleted" placeholder for anyone's deleted message.
 */
export async function getThread(
  conversationId: string,
  viewerPersonId: string,
  asModerator: boolean
): Promise<Thread | null> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      subject: true,
      participants: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          deletedAt: true,
          senderId: true,
          sender: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!c) return null;
  const isParticipant = c.participants.some((p) => p.personId === viewerPersonId);
  if (!isParticipant && !asModerator) return null;

  const messages: ThreadMessage[] = c.messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    deleted: !!m.deletedAt,
    mine: m.senderId === viewerPersonId,
    senderName: fullName(m.sender),
  }));

  return {
    id: c.id,
    subject: c.subject,
    participantIds: c.participants.map((p) => p.personId),
    others: c.participants.filter((p) => p.personId !== viewerPersonId).map((p) => fullName(p.person)).join(", "),
    messages,
  };
}

/** Mark a conversation read for a participant (best-effort; no-op if not one). */
export async function markRead(conversationId: string, personId: string): Promise<void> {
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, personId },
    data: { lastReadAt: new Date() },
  });
}
