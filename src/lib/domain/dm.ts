import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { isStaff, isAdmin } from "@/lib/rbac";
import { effectiveRoles } from "@/lib/enums";
import { recordSmsRoute } from "@/lib/domain/smsRouting";
import { SMS_FULL_CAP } from "@/lib/messaging";

// Direct-message primitives shared by the messaging route handler and the
// inbound-SMS webhook, so a reply that arrives by text lands in the same 1:1
// thread — and notifies the sender the same way — as a reply typed in the app.

export type NotifyChoice = { email: boolean; sms: boolean };
export type Attach = { url: string; type: string | null } | null;

/** Find the existing 1:1 thread between two people, or create one. */
export async function findOrCreateConversation(aPersonId: string, bPersonId: string): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: {
      participants: { every: { personId: { in: [aPersonId, bPersonId] } } },
      AND: [
        { participants: { some: { personId: aPersonId } } },
        { participants: { some: { personId: bPersonId } } },
      ],
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const convo = await prisma.conversation.create({
    data: { createdById: aPersonId, participants: { create: [{ personId: aPersonId }, { personId: bPersonId }] } },
    select: { id: true },
  });
  return convo.id;
}

/** Append a message, resurface the thread for everyone, and bump its sort time. */
export async function appendMessage(
  conversationId: string,
  senderId: string,
  body: string,
  notify: NotifyChoice = { email: true, sms: false },
  attach: Attach = null,
  externalId: string | null = null,
  dedupeMs = 0,
) {
  // Collapse an accidental repeat submit: the same sender posting the identical
  // message to the same thread within a short window (e.g. tapping Send several
  // times while the page navigates). Returns without creating a second row or
  // firing a second notification.
  if (dedupeMs > 0) {
    const recent = await prisma.chatMessage.findFirst({
      where: {
        conversationId,
        senderId,
        body,
        attachmentUrl: attach?.url ?? null,
        createdAt: { gte: new Date(Date.now() - dedupeMs) },
      },
      select: { id: true },
    });
    if (recent) return;
  }
  await prisma.chatMessage.create({
    data: { conversationId, senderId, body, attachmentUrl: attach?.url ?? null, attachmentType: attach?.type ?? null, externalId },
  });
  const now = new Date();
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  await prisma.conversationParticipant.updateMany({ where: { conversationId }, data: { hiddenAt: null } });
  await prisma.conversationParticipant.updateMany({ where: { conversationId, personId: senderId }, data: { lastReadAt: now } });
  const previewBody = body || (attach ? (attach.type === "VIDEO" ? "📹 sent a video" : "📷 sent a photo") : "");
  await notifyOtherParticipants(conversationId, senderId, previewBody, notify);
}

/** Notify the other people on a thread. Staff (admins/coaches) are ALWAYS
 *  emailed and texted so an inbound question is never missed — regardless of
 *  what the sender toggled. For non-staff recipients we honor the sender's
 *  chosen channels. Every text we send records an SMS route so the recipient's
 *  text-back is delivered to the sender. */
export async function notifyOtherParticipants(conversationId: string, senderId: string, body: string, notify: NotifyChoice) {
  try {
    const [sender, parts] = await Promise.all([
      prisma.person.findUnique({ where: { id: senderId }, select: { firstName: true, lastName: true, email: true, user: { select: { role: true, extraRoles: true } } } }),
      prisma.conversationParticipant.findMany({
        where: { conversationId, personId: { not: senderId } },
        select: { personId: true, person: { select: { email: true, email2: true, email3: true, phone: true, user: { select: { role: true, extraRoles: true } } } } },
      }),
    ]);
    const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "PURE Academy";
    // Identify the sender by role (Coach / Admin) and, for a team thread, which
    // team — so every notification says exactly who and what it's about.
    const senderRoles = sender?.user ? effectiveRoles(sender.user) : [];
    const roleWord = isAdmin(senderRoles) ? "Admin" : senderRoles.includes("COACH") ? "Coach" : null;
    const senderLabel = roleWord ? `${roleWord} ${senderName}` : senderName;
    const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { kind: true, teamId: true } });
    let teamName: string | null = null;
    if (convo?.kind === "TEAM" && convo.teamId) {
      teamName = (await prisma.team.findUnique({ where: { id: convo.teamId }, select: { name: true } }))?.name ?? null;
    }
    // "from" attribution used in every channel.
    const fromLine = teamName ? `${teamName} · ${senderLabel}` : senderLabel;

    // Every direct message reaches the recipient by BOTH text and email (and the
    // in-app thread, always recorded) so messages are caught quickly — no
    // dependence on a notify toggle or on who's staff. (`notify` is kept for
    // signature compatibility; direct messages always notify on every channel.)
    void notify;
    const preview = body.length > SMS_FULL_CAP ? `${body.slice(0, SMS_FULL_CAP).trimEnd()}…` : body;
    for (const p of parts) {
      const per = p.person;
      const staff = per.user ? isStaff(effectiveRoles(per.user)) : false;
      const link = `${appUrl()}${staff ? "/console/inbox" : "/portal/inbox"}/${conversationId}`;
      // Email — every message, to every address on file.
      const emails = [per.email, per.email2, per.email3].filter((e): e is string => !!e);
      if (emails.length) {
        await sendEmail(
          emails,
          teamName ? `${teamName} — new message from ${senderLabel}` : `New message from ${senderLabel}`,
          `${fromLine} sent a message on PURE Academy:\n\n“${preview}”\n\nRead & reply: ${link}\n\nBest is to reply from your inbox (link above) — it keeps the whole conversation in one place. If you reply to this email, it goes straight to ${senderName}.`,
          undefined,
          undefined,
          // Route email replies to the sender (the coach), not the shared inbox.
          { replyTo: sender?.email ? [sender.email, "team@purepickleball.com"] : null },
        );
      }
      // Text — every message, whenever we have a number on file.
      if (per.phone) {
        await sendSms(per.phone, `${fromLine}: “${preview}”. Read & reply: ${link}`);
        // Remember who texted this person so their text-back routes to the sender.
        await recordSmsRoute({ phone: per.phone, personId: p.personId, senderPersonId: senderId, conversationId });
      }
    }
  } catch (e) {
    console.error("new-message notification failed", e);
  }
}
