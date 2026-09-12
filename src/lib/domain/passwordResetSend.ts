import "server-only";
import { prisma } from "@/lib/db";
import { createResetToken, INVITE_TTL_MS } from "@/lib/passwordReset";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";

// Send a "set / reset your password" link to the right person for a given
// player. For a minor with no contact info of their own, the link goes to the
// parent/guardian — whose login actually manages the portal — by BOTH email and
// text. Admin-initiated, so the link is valid for 7 days (like an invite).

export type ResetSendResult =
  | { ok: true; toName: string; viaGuardian: boolean; emailed: number; texted: boolean }
  | { ok: false; reason: "not-found" | "no-account" | "inactive" | "no-contact" };

type Contact = { email: string | null; email2: string | null; email3: string | null; phone: string | null };
const emailsOf = (c: Contact) => Array.from(new Set([c.email, c.email2, c.email3].map((e) => (e ?? "").trim()).filter(Boolean)));

export async function sendResetLinkForPerson(personId: string): Promise<ResetSendResult> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true, firstName: true, lastName: true,
      email: true, email2: true, email3: true, phone: true,
      user: { select: { id: true, active: true } },
      guardian: {
        select: {
          id: true, firstName: true, lastName: true, email: true, email2: true, email3: true, phone: true,
          user: { select: { id: true, active: true } },
        },
      },
    },
  });
  if (!person) return { ok: false, reason: "not-found" };

  const ownHasContact = emailsOf(person).length > 0 || !!person.phone;

  // Resolve the account that logs in, and who receives the link.
  let accountUserId: string | null = null;
  let accountActive = true;
  let recipient: (Contact & { name: string }) | null = null;
  let viaGuardian = false;

  if (person.user && ownHasContact) {
    accountUserId = person.user.id;
    accountActive = person.user.active;
    recipient = { ...person, name: `${person.firstName} ${person.lastName}`.trim() };
  } else if (person.guardian?.user) {
    // Minor / no own contact → the guardian holds the login and gets the link.
    accountUserId = person.guardian.user.id;
    accountActive = person.guardian.user.active;
    recipient = {
      email: person.guardian.email, email2: person.guardian.email2, email3: person.guardian.email3, phone: person.guardian.phone,
      name: `${person.guardian.firstName} ${person.guardian.lastName}`.trim(),
    };
    viaGuardian = true;
  } else if (person.user) {
    // Own login but no contact and no guardian — reset it, though we may have
    // nowhere to send (caught below).
    accountUserId = person.user.id;
    accountActive = person.user.active;
    recipient = { ...person, name: `${person.firstName} ${person.lastName}`.trim() };
  }

  if (!accountUserId) return { ok: false, reason: "no-account" };
  if (!accountActive) return { ok: false, reason: "inactive" };
  if (!recipient) return { ok: false, reason: "no-contact" };

  const emails = emailsOf(recipient);
  const phone = recipient.phone;
  if (!emails.length && !phone) return { ok: false, reason: "no-contact" };

  const token = await createResetToken(accountUserId, INVITE_TTL_MS);
  const link = `${appUrl()}/reset?token=${token}`;
  const forWhom = viaGuardian ? ` for ${person.firstName}` : "";

  if (emails.length) {
    await sendEmail(
      emails,
      "Set your PURE Academy password",
      `Here's your link to set a new PURE Academy password${forWhom} (expires in 7 days):\n${link}\n\n` +
        `After you set it you'll be signed straight into the portal.\n\n` +
        `If you didn't request this, you can ignore this email.`,
    ).catch(() => {});
  }
  if (phone) {
    await sendSms(
      phone,
      `Set your PURE Academy password${forWhom} (expires in 7 days): ${link} — you'll be signed into the portal after.`,
    ).catch(() => {});
  }
  return { ok: true, toName: recipient.name, viaGuardian, emailed: emails.length, texted: !!phone };
}
