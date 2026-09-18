import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { createResetToken, INVITE_TTL_MS } from "@/lib/passwordReset";
import { hashPassword } from "@/lib/auth";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";

// Send a "set / reset your password" link to the right person for a given
// player — and CREATE their portal login first if they don't have one yet, so
// "Text reset link" always gives them a way in. For a minor with no contact of
// their own, the login/link belongs to the parent/guardian. Admin-initiated, so
// the link is valid for 7 days (like an invite). Sent by BOTH email and text.

export type ResetSendResult =
  | { ok: true; toName: string; viaGuardian: boolean; created: boolean; emailed: number; texted: boolean }
  | { ok: false; reason: "not-found" | "inactive" | "no-email" | "no-contact" };

type Contact = { email: string | null; email2: string | null; email3: string | null; phone: string | null };
const emailsOf = (c: Contact) => Array.from(new Set([c.email, c.email2, c.email3].map((e) => (e ?? "").trim()).filter(Boolean)));

/** Reuse the login for this email, or create one (active) for the person. */
async function ensureLogin(email: string, role: "PLAYER" | "PARENT", personId: string): Promise<string> {
  const norm = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: norm }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: { email: norm, passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")), role, personId, active: true },
    select: { id: true },
  });
  return created.id;
}

// Mint a single "set your password, then land on `nextPath`" link for a person
// — creating their portal login if needed (guardian's for a minor with no email
// of their own). Used to fold the waiver + password steps into ONE message when
// someone claims a sub spot. Returns null when there's no email anywhere to base
// a login on (caller falls back to a plain public link, e.g. the waiver itself).
export async function mintPortalAccessLink(personId: string, nextPath: string): Promise<string | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true, firstName: true, lastName: true, email: true, email2: true, email3: true, phone: true,
      _count: { select: { dependents: true } },
      user: { select: { id: true, active: true } },
      guardian: {
        select: {
          id: true, email: true, email2: true, email3: true, phone: true,
          user: { select: { id: true, active: true } },
        },
      },
    },
  });
  if (!person) return null;

  const guardian = person.guardian;
  let accountUserId: string;

  if (person.user) {
    if (!person.user.active) return null;
    accountUserId = person.user.id;
  } else if (guardian?.user) {
    if (!guardian.user.active) return null;
    accountUserId = guardian.user.id;
  } else {
    const personEmails = emailsOf(person);
    const guardianEmails = guardian ? emailsOf(guardian) : [];
    if (personEmails.length) {
      accountUserId = await ensureLogin(personEmails[0], person._count.dependents > 0 ? "PARENT" : "PLAYER", person.id);
    } else if (guardian && guardianEmails.length) {
      accountUserId = await ensureLogin(guardianEmails[0], "PARENT", guardian.id);
    } else {
      return null; // No email to base a login on.
    }
  }

  const token = await createResetToken(accountUserId, INVITE_TTL_MS);
  const local = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/portal";
  return `${appUrl()}/reset?token=${token}&invite=1&next=${encodeURIComponent(local)}`;
}

export async function sendResetLinkForPerson(personId: string): Promise<ResetSendResult> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true, firstName: true, lastName: true,
      email: true, email2: true, email3: true, phone: true,
      _count: { select: { dependents: true } },
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

  const personEmails = emailsOf(person);
  const guardian = person.guardian;
  const guardianEmails = guardian ? emailsOf(guardian) : [];

  let accountUserId: string | null = null;
  let accountActive = true;
  let recipient: (Contact & { name: string }) | null = null;
  let viaGuardian = false;
  let created = false;

  if (person.user) {
    accountUserId = person.user.id;
    accountActive = person.user.active;
    recipient = { ...person, name: `${person.firstName} ${person.lastName}`.trim() };
  } else if (guardian?.user) {
    accountUserId = guardian.user.id;
    accountActive = guardian.user.active;
    recipient = { email: guardian.email, email2: guardian.email2, email3: guardian.email3, phone: guardian.phone, name: `${guardian.firstName} ${guardian.lastName}`.trim() };
    viaGuardian = true;
  } else if (personEmails.length) {
    // No login yet, but they have an email → create their own portal login.
    accountUserId = await ensureLogin(personEmails[0], person._count.dependents > 0 ? "PARENT" : "PLAYER", person.id);
    recipient = { ...person, name: `${person.firstName} ${person.lastName}`.trim() };
    created = true;
  } else if (guardian && guardianEmails.length) {
    // Minor with no email of their own → create/point to the guardian's login.
    accountUserId = await ensureLogin(guardianEmails[0], "PARENT", guardian.id);
    recipient = { email: guardian.email, email2: guardian.email2, email3: guardian.email3, phone: guardian.phone, name: `${guardian.firstName} ${guardian.lastName}`.trim() };
    viaGuardian = true;
    created = true;
  } else {
    // No email anywhere to base a login on.
    return { ok: false, reason: "no-email" };
  }

  if (!accountActive) return { ok: false, reason: "inactive" };
  if (!recipient) return { ok: false, reason: "no-email" };

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
      `Here's your link to set your PURE Academy portal password${forWhom}:\n${link}\n\n` +
        `After you set it you'll be signed straight into the portal.\n\n` +
        `If you didn't expect this, you can ignore this email.`,
    ).catch(() => {});
  }
  if (phone) {
    await sendSms(
      phone,
      `Set your PURE Academy portal password${forWhom}: ${link} — you'll be signed into the portal after.`,
    ).catch(() => {});
  }
  return { ok: true, toName: recipient.name, viaGuardian, created, emailed: emails.length, texted: !!phone };
}
