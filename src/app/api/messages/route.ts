import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canUseMessagingPerson, canReachPerson } from "@/lib/domain/messaging-acl";

// Direct-messaging mutations (start / reply / delete a message / archive a
// thread) as native-form POSTs with ticket auth, shared by the console (admin,
// coach) and the family portal (parent). Retention is enforced by soft-deletes:
// a "deleted" message keeps its row (deletedAt) and an "archived" thread keeps
// its participant row (hiddenAt) so an Admin can always review the exchange.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();

  // Bounce target — only ever an inbox path. Defaults to the console inbox.
  const rawReturn = String(fd.get("returnTo") ?? "");
  const base = rawReturn.startsWith("/portal/inbox")
    ? "/portal/inbox"
    : "/console/inbox";
  const back = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("/login");

  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const myPersonId = me?.personId ?? "";
  if (!myPersonId) return back(`${base}?err=perm`);
  // Age-aware gate: staff/parents always; a player only if 12+.
  if (!(await canUseMessagingPerson(myPersonId, actor.role))) return back(`${base}?err=perm`);

  const op = String(fd.get("op") ?? "");

  if (op === "start") {
    const recipientId = String(fd.get("recipientId") ?? "").trim();
    const body = String(fd.get("body") ?? "").trim();
    if (!recipientId || !body) return back(`${base}?err=fields`);
    if (!(await canReachPerson(myPersonId, actor.role, recipientId))) return back(`${base}?err=perm`);

    // Reuse an existing 1:1 thread between exactly these two people.
    const existing = await prisma.conversation.findFirst({
      where: {
        participants: { every: { personId: { in: [myPersonId, recipientId] } } },
        AND: [
          { participants: { some: { personId: myPersonId } } },
          { participants: { some: { personId: recipientId } } },
        ],
      },
      select: { id: true },
    });

    let conversationId: string;
    if (existing) {
      conversationId = existing.id;
    } else {
      const convo = await prisma.conversation.create({
        data: {
          createdById: myPersonId,
          participants: { create: [{ personId: myPersonId }, { personId: recipientId }] },
        },
        select: { id: true },
      });
      conversationId = convo.id;
    }

    await appendMessage(conversationId, myPersonId, body);
    await audit({ actorId: actor.userId, entityType: "Conversation", entityId: conversationId, action: "message.start", summary: `Messaged ${recipientId}` });
    return back(`${base}/${conversationId}`);
  }

  if (op === "reply") {
    const conversationId = String(fd.get("conversationId") ?? "").trim();
    const body = String(fd.get("body") ?? "").trim();
    if (!conversationId || !body) return back(`${base}?err=fields`);
    const part = await prisma.conversationParticipant.findFirst({
      where: { conversationId, personId: myPersonId },
      select: { id: true },
    });
    if (!part) return back(`${base}?err=perm`);
    await appendMessage(conversationId, myPersonId, body);
    return back(`${base}/${conversationId}`);
  }

  if (op === "deleteMessage") {
    const messageId = String(fd.get("messageId") ?? "").trim();
    const conversationId = String(fd.get("conversationId") ?? "").trim();
    if (!messageId) return back(`${base}?err=fields`);
    // Only the author may delete their own message. The row is retained.
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { senderId: true } });
    if (!msg || msg.senderId !== myPersonId) return back(`${base}/${conversationId}?err=perm`);
    await prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    return back(`${base}/${conversationId}?ok=deleted`);
  }

  if (op === "archive") {
    const conversationId = String(fd.get("conversationId") ?? "").trim();
    if (!conversationId) return back(`${base}?err=fields`);
    // Hide from this user only — the thread and its messages are retained.
    await prisma.conversationParticipant.updateMany({
      where: { conversationId, personId: myPersonId },
      data: { hiddenAt: new Date() },
    });
    return back(`${base}?ok=archived`);
  }

  return back(`${base}?err=op`);
}

/** Append a message, resurface the thread for everyone, and bump its sort time. */
async function appendMessage(conversationId: string, senderId: string, body: string) {
  await prisma.chatMessage.create({ data: { conversationId, senderId, body } });
  const now = new Date();
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  // A new message un-archives the thread for every participant…
  await prisma.conversationParticipant.updateMany({ where: { conversationId }, data: { hiddenAt: null } });
  // …and counts as read for the sender.
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, personId: senderId },
    data: { lastReadAt: now },
  });
}
