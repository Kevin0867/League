import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createResetToken } from "@/lib/passwordReset";
import { sendEmail, sendSms } from "@/lib/notify";
import { normPhone } from "@/lib/domain/smsRouting";

// Request a password reset. Always redirects to the same "if it exists, we sent
// it" state — never reveals whether an account exists. We match the account by
// its login email, by any contact email on the person, OR by phone — and we
// send the reset link by BOTH email and text, so a login-email mismatch or a
// bouncing inbox doesn't leave the person locked out.
export const dynamic = "force-dynamic";

type UserWithPerson = {
  id: string;
  email: string;
  active: boolean;
  person: { email: string | null; email2: string | null; email3: string | null; phone: string | null } | null;
};

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const raw = String(form.get("email") ?? form.get("identifier") ?? "").trim();
  const base = process.env.NEXT_PUBLIC_APP_URL || origin;

  if (raw) {
    const email = raw.toLowerCase();
    const phone = normPhone(raw);
    const users = new Map<string, UserWithPerson>();

    // 1) Direct match on the login email.
    const direct = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, active: true, person: { select: { email: true, email2: true, email3: true, phone: true } } },
    });
    if (direct) users.set(direct.id, direct);

    // 2) A person carrying this address as any of their contact emails — their
    //    login email may differ from the email they typed.
    const byEmail = await prisma.person.findMany({
      where: { OR: [
        { email: { equals: raw, mode: "insensitive" } },
        { email2: { equals: raw, mode: "insensitive" } },
        { email3: { equals: raw, mode: "insensitive" } },
      ] },
      select: { email: true, email2: true, email3: true, phone: true, user: { select: { id: true, email: true, active: true } } },
      take: 10,
    });
    for (const p of byEmail) if (p.user) users.set(p.user.id, { ...p.user, person: { email: p.email, email2: p.email2, email3: p.email3, phone: p.phone } });

    // 3) A person whose phone matches (they may have typed a number).
    if (phone) {
      const byPhone = await prisma.person.findMany({
        where: { phone: { contains: phone } },
        select: { email: true, email2: true, email3: true, phone: true, user: { select: { id: true, email: true, active: true } } },
        take: 10,
      });
      for (const p of byPhone) if (p.user && normPhone(p.phone) === phone) users.set(p.user.id, { ...p.user, person: { email: p.email, email2: p.email2, email3: p.email3, phone: p.phone } });
    }

    for (const u of users.values()) {
      if (!u.active) continue;
      const token = await createResetToken(u.id);
      const link = `${base}/reset?token=${token}`;

      const emails = Array.from(new Set([u.email, u.person?.email, u.person?.email2, u.person?.email3]
        .map((e) => (e ?? "").trim())
        .filter(Boolean)));
      if (emails.length) {
        await sendEmail(
          emails,
          "Reset your PURE Academy password",
          `A password reset was requested for your PURE Academy account.\n\n` +
            `Reset your password (this link expires in 1 hour):\n${link}\n\n` +
            `After you set a new password you'll be signed straight into your portal.\n\n` +
            `If you didn't request this, you can safely ignore this email.`,
        ).catch(() => {});
      }
      if (u.person?.phone) {
        await sendSms(
          u.person.phone,
          `Reset your PURE Academy password here (expires in 1 hour): ${link} — you'll be signed into your portal after. Didn't request it? Ignore this.`,
        ).catch(() => {});
      }
    }
  }

  return NextResponse.redirect(new URL("/forgot?sent=1", origin), 303);
}
