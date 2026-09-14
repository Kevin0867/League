import "server-only";
import { prisma } from "@/lib/db";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { personSearchOR } from "@/lib/domain/personSearch";

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
          kind: true,
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
    const names = c.participants.filter((pt) => pt.personId !== personId).map((pt) => fullName(pt.person)).join(", ");
    // A group thread is shown by its name (e.g. "Mesa M4.0 — team chat"), not a
    // long list of everyone in it.
    const others = c.kind !== "DIRECT" && c.subject ? c.subject : names || "(no one)";
    const last = c.messages[0];
    const preview = !last ? "No messages yet" : last.deletedAt ? "Message deleted" : last.body;
    const unread = !!last && last.senderId !== personId && (!p.lastReadAt || last.createdAt > p.lastReadAt);
    return { id: c.id, subject: c.subject, others, preview, lastMessageAt: c.lastMessageAt, unread };
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
            // A participant by name, email, or phone (any format).
            { participants: { some: { person: { OR: personSearchOR(term) } } } },
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
      kind: true,
      lastMessageAt: true,
      participants: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } },
      // The most recent message that matches the term (for the snippet); empty
      // when the hit was in the subject or a participant name.
      messages: { where: bodyWhere, orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
    },
  });
  return convos.map((c) => {
    const names = c.participants.filter((pt) => pt.personId !== personId).map((pt) => fullName(pt.person)).join(asModerator ? " ↔ " : ", ");
    const others = c.kind !== "DIRECT" && c.subject ? c.subject : names || "(no one)";
    const hit = c.messages[0];
    return {
      id: c.id,
      subject: c.subject,
      others,
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
  kind: string;
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
      kind: true,
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

  const names = c.participants.filter((p) => p.personId !== viewerPersonId).map((p) => fullName(p.person)).join(", ");
  return {
    id: c.id,
    subject: c.subject,
    kind: c.kind,
    participantIds: c.participants.map((p) => p.personId),
    // Group threads are titled by their name; DMs by the other person.
    others: c.kind !== "DIRECT" && c.subject ? c.subject : names,
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

// ── Coach moderation: messages within the teams a coach coaches ──────────────
// The set of person ids on a coach's teams (players, their guardians, and the
// coaching staff). Used to scope what a coach may moderate.
export async function coachTeamPersonIds(userId: string): Promise<Set<string>> {
  const teamIds = await coachedTeamIdsForUser(userId);
  if (!teamIds.length) return new Set();
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: {
      coach: { select: { personId: true } },
      assistantCoaches: { select: { coach: { select: { personId: true } } } },
      members: { select: { personId: true, person: { select: { guardianId: true } } } },
    },
  });
  const ids = new Set<string>();
  for (const t of teams) {
    if (t.coach?.personId) ids.add(t.coach.personId);
    for (const ac of t.assistantCoaches) if (ac.coach?.personId) ids.add(ac.coach.personId);
    for (const m of t.members) { ids.add(m.personId); if (m.person?.guardianId) ids.add(m.person.guardianId); }
  }
  return ids;
}

/** Whether this coach may moderate a specific conversation: every participant
 *  must be within their teams (a teammate DM, an intra-team thread). Team
 *  threads they're already in also pass. */
export async function canCoachModerate(userId: string, conversationId: string): Promise<boolean> {
  const [ids, convo] = await Promise.all([
    coachTeamPersonIds(userId),
    prisma.conversation.findUnique({ where: { id: conversationId }, select: { participants: { select: { personId: true } } } }),
  ]);
  if (!convo || ids.size === 0) return false;
  return convo.participants.length > 0 && convo.participants.every((p) => ids.has(p.personId));
}

/** Conversations within a coach's teams that they are NOT already a participant
 *  of — i.e. player↔player (and player↔parent) DMs to supervise. Team threads
 *  the coach is in already appear in their normal inbox. */
export async function coachModerationItems(userId: string): Promise<InboxItem[]> {
  const ids = await coachTeamPersonIds(userId);
  if (ids.size === 0) return [];
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { personId: true } });
  const myPersonId = me?.personId ?? "";
  const convos = await prisma.conversation.findMany({
    where: { participants: { some: { personId: { in: [...ids] } } } },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
    select: {
      id: true, subject: true, kind: true, lastMessageAt: true,
      participants: { select: { personId: true, lastReadAt: true, person: { select: { firstName: true, lastName: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, deletedAt: true, senderId: true, createdAt: true } },
    },
  });
  return convos
    .filter((c) => c.participants.every((p) => ids.has(p.personId)) && !c.participants.some((p) => p.personId === myPersonId))
    .map((c) => {
      const names = c.participants.map((p) => fullName(p.person)).join(" ↔ ");
      const others = c.kind !== "DIRECT" && c.subject ? c.subject : names || "(no one)";
      const last = c.messages[0];
      return {
        id: c.id,
        subject: c.subject,
        others,
        preview: !last ? "No messages yet" : last.deletedAt ? "Message deleted" : last.body,
        lastMessageAt: c.lastMessageAt,
        unread: moderationUnread(c.participants, last),
      };
    });
}

export async function coachModerationUnreadCount(userId: string): Promise<number> {
  return (await coachModerationItems(userId)).filter((i) => i.unread).length;
}
