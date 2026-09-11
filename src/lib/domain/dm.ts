import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { isStaff } from "@/lib/rbac";
import type { Role } from "@/lib/enums";
import { recordSmsRoute } from "@/lib/domain/smsRouting";

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
) {
  await prisma.chatMessage.create({
    data: { conversationId, senderId, body, attachmentUrl: attach?.url ?? null, attachmentType: attach?.type ?? null },
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
      prisma.person.findUnique({ where: { id: senderId }, select: { firstName: true, lastName: true } }),
      prisma.conversationParticipant.findMany({
        where: { conversationId, personId: { not: senderId } },
        select: { personId: true, person: { select: { email: true, email2: true, email3: true, phone: true, user: { select: { role: true } } } } },
      }),
    ]);
    const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "PURE Academy";
    const preview = body.length > 160 ? `${body.slice(0, 160)}…` : body;
    for (const p of parts) {
      const per = p.person;
      const staff = per.user?.role ? isStaff(per.user.role as Role) : false;
      const doEmail = staff || notify.email;
      const doSms = staff || notify.sms;
      if (!doEmail && !doSms) continue;
      const link = `${appUrl()}${staff ? "/console/inbox" : "/portal/inbox"}/${conversationId}`;
      if (doEmail) {
        const emails = [per.email, per.email2, per.email3].filter((e): e is string => !!e);
        if (emails.length) {
          await sendEmail(
            emails,
            `New message from ${senderName}`,
            `${senderName} sent you a message on PURE Academy:\n\n“${preview}”\n\nRead & reply: ${link}\n\nYou can reply from your inbox — they’ll be notified.`,
          );
        }
      }
      if (doSms && per.phone) {
        await sendSms(per.phone, `New message from ${senderName}: “${preview}”. Read & reply: ${link}`);
        // Remember who texted this person so their text-back routes to the sender.
        await recordSmsRoute({ phone: per.phone, personId: p.personId, senderPersonId: senderId, conversationId });
      }
    }
  } catch (e) {
    console.error("new-message notification failed", e);
  }
}
