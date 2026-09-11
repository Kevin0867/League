import "server-only";
import { prisma } from "@/lib/db";

// Routes inbound SMS replies back to whoever last texted the person, so a coach
// (or admin) who sends a message and gets a text reply sees that reply in their
// portal inbox and is notified immediately — instead of the reply being lost to
// the shared team inbox.

/** Normalize a phone to its last 10 digits for reliable matching across the
 *  various formats we store/receive (+1XXXXXXXXXX, (XXX) XXX-XXXX, etc.). */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Record (upsert) who last texted a phone number. Best-effort — a failure here
 *  must never block the outbound send. */
export async function recordSmsRoute(opts: {
  phone: string;
  personId?: string | null;
  senderPersonId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}): Promise<void> {
  const phone = normPhone(opts.phone);
  if (!phone || !opts.senderPersonId) return; // nothing to route back to
  try {
    await prisma.smsRoute.upsert({
      where: { phone },
      create: {
        phone,
        personId: opts.personId ?? null,
        senderPersonId: opts.senderPersonId,
        conversationId: opts.conversationId ?? null,
        messageId: opts.messageId ?? null,
      },
      update: {
        personId: opts.personId ?? undefined,
        senderPersonId: opts.senderPersonId,
        conversationId: opts.conversationId ?? null,
        messageId: opts.messageId ?? null,
      },
    });
  } catch (e) {
    console.error("recordSmsRoute failed", e);
  }
}

export type InboundRoute = {
  senderPersonId: string;
  recipientPersonId: string | null;
  conversationId: string | null;
};

/** Look up where an inbound SMS from `fromPhone` should be routed. Prefers the
 *  stored route (who last texted them); falls back to identifying the person by
 *  phone so at least the reply is attributed. */
export async function lookupInboundRoute(fromPhone: string): Promise<InboundRoute | null> {
  const phone = normPhone(fromPhone);
  if (!phone) return null;
  const route = await prisma.smsRoute.findUnique({ where: { phone } });
  if (route?.senderPersonId) {
    return { senderPersonId: route.senderPersonId, recipientPersonId: route.personId, conversationId: route.conversationId };
  }
  return null;
}

/** Best-effort: find the Person who owns a phone number, matching on the last
 *  10 digits across the phone fields we store. */
export async function findPersonByPhone(fromPhone: string): Promise<{ id: string; firstName: string; lastName: string } | null> {
  const phone = normPhone(fromPhone);
  if (!phone) return null;
  // Match the last-10-digit tail; a contains on the bare 10 digits catches the
  // common stored formats (+1XXXXXXXXXX and XXXXXXXXXX).
  const candidates = await prisma.person.findMany({
    where: { phone: { contains: phone } },
    select: { id: true, firstName: true, lastName: true, phone: true },
    take: 5,
  });
  const exact = candidates.find((c) => normPhone(c.phone) === phone);
  return exact ?? candidates[0] ?? null;
}
