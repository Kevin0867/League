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
// A conversation is "unread" for moderation when a recipient hasn't yet read
// the latest message — i.e. someone is waiting on a reply.
function moderationUnread(
  participants: { personId: string; lastReadAt: Date | null }[],
  last: { senderId: string; createdAt: Date } | undefined,
): boolean {
  if (!last) return false;
  return participants.some((p) => p.personId !== last.senderId && (!p.lastReadAt || p.lastReadAt < last.createdAt));
}

export async function moderationItems(): Promise<InboxItem[]> {
  const convos = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    select: {
      id: true,
      subject: true,
      lastMessageAt: true,
      participants: { select: { personId: true, lastReadAt: true, person: { select: { firstName: true, lastName: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, deletedAt: true, senderId: true, createdAt: true } },
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
      unread: moderationUnread(c.participants, last),
    };
  });
}

/** How many conversations platform-wide have a message a recipient hasn't read
 *  yet — the "All conversations" badge for admins. */
export async function moderationUnreadCount(): Promise<number> {
  const convos = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 500,
    select: {
      participants: { select: { personId: true, lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { senderId: true, createdAt: true } },
    },
  });
  return convos.reduce((n, c) => n + (moderationUnread(c.participants, c.messages[0]) ? 1 : 0), 0);
}

/**
 * Search conversations by text — subject, a participant's name, or any message
 * body — so every message is findable, not just the latest preview. Scoped to
 * the person's own conversations unless `asModerator` (admins search all). The
 * preview shows the matching message when the hit is in the body.
 */
export async function searchInbox(personId: string, q: string, asModerator: boolean): Promise<InboxItem[]> {
  const term = q.trim();
  if (!term) return asModerator ? moderationItems() : inboxItems(personId);
  const ci = { contains: term, mode: "insensitive" as const };
  const scope = asModerator ? {} : { participants: { some: { personId, hiddenAt: null } } };
  const bodyWhere = asModerator ? { body: ci } : { body: ci, deletedAt: null };
  const convos = await prisma.conversation.findMany({
    where: {
      AND: [
        scope,
        {
          OR: [
            { subject: ci },
            { participants: { some: { person: { OR: [{ firstName: ci }, { lastName: ci }] } } } },
            { messages: { some: bodyWhere } },
          ],
        },
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      subject: true,
      lastMessageAt: true,
      participants: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } },
      // The most recent message that matches the term (for the snippet); empty
      // when the hit was in the subject or a participant name.
      messages: { where: bodyWhere, orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
    },
  });
  return convos.map((c) => {
    const others = c.participants.filter((pt) => pt.personId !== personId).map((pt) => fullName(pt.person)).join(asModerator ? " ↔ " : ", ");
    const hit = c.messages[0];
    return {
      id: c.id,
      subject: c.subject,
      others: others || (asModerator ? "(no one)" : "(no one)"),
      preview: hit ? hit.body : "Matched subject or participant",
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
  attachmentUrl: string | null;
  attachmentType: string | null;
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
          attachmentUrl: true,
          attachmentType: true,
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
    // A deleted message's attachment is withheld too (moderators see the note).
    attachmentUrl: m.deletedAt ? null : m.attachmentUrl,
    attachmentType: m.deletedAt ? null : m.attachmentType,
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
