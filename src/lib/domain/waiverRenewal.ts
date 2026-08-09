import "server-only";
import type { PrismaClient } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";
import { appUrl } from "@/lib/stripe";
import { sendEmail } from "@/lib/notify";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";

// When a minor turns 18, their parent-signed waiver is no longer valid — they
// must sign their own adult waiver. A daily job flags them and emails a signed,
// tokenized link to re-sign. See /api/cron/waiver-renewal and /waiver/renew.

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const SCOPE = "waiver-renew";

export function age(dob: Date, on: Date = new Date()): number {
  let a = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) a--;
  return a;
}

export async function signWaiverToken(personId: string, ttlDays = 120): Promise<string> {
  return new SignJWT({ personId, scope: SCOPE, kind: "waiver" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlDays * 86400)
    .sign(secret);
}

export async function verifyWaiverToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind !== "waiver" || payload.scope !== SCOPE) return null;
    return String(payload.personId);
  } catch {
    return null;
  }
}

/** People still flagged as minors whose DOB now makes them 18+. */
export async function findNewlyAdultMinors(db: PrismaClient) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return db.person.findMany({
    where: { isMinor: true, dob: { not: null, lte: cutoff } },
  });
}

/**
 * Flag one newly-adult person: no longer a minor, existing parent-signed waiver
 * invalidated, renewal required. Emails them a link to sign the adult waiver.
 * Idempotent — skips anyone already flagged.
 */
export async function flagAndNotify(
  db: PrismaClient,
  person: { id: string; firstName: string; email: string | null; waiverRenewalRequiredAt: Date | null }
): Promise<"flagged" | "already" | "no-email"> {
  if (person.waiverRenewalRequiredAt) return "already";

  await db.person.update({
    where: { id: person.id },
    data: { isMinor: false, waiverRenewalRequiredAt: new Date(), waiverSignedAt: null },
  });

  if (!person.email) return "no-email";

  const token = await signWaiverToken(person.id);
  const link = `${appUrl()}/waiver/renew?token=${encodeURIComponent(token)}`;
  const subject = "Action needed: sign your PURE Academy waiver (you've turned 18)";
  const text =
    `Hi ${person.firstName},\n\n` +
    `Happy 18th! Now that you're an adult, the waiver your parent or guardian signed for you is no longer valid. ` +
    `Please sign your own participation waiver before your next practice:\n\n${link}\n\n` +
    `It only takes a minute. Thanks!\n— PURE Academy`;
  const html = brandedEmailHtml({
    heading: `Happy 18th, ${person.firstName}!`,
    intro:
      "Now that you're an adult, the waiver your parent or guardian signed for you is no longer valid.",
    contentHtml:
      `<p style="margin:0 0 14px;font-size:14px;color:#475569">Please sign your own participation waiver before your next practice — it only takes a minute.</p>` +
      emailButton(link, "Sign my waiver", { primary: true }) +
      `<p style="margin:12px 0 0;font-size:12px;color:#94a3b8">Or paste this link into your browser: ${link}</p>`,
  });
  await sendEmail(person.email, subject, text, html);
  return "flagged";
}
