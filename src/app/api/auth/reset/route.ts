import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { consumeResetToken } from "@/lib/passwordReset";
import { isStaff } from "@/lib/rbac";
import type { Role } from "@/lib/enums";

// Complete a password reset: validate + consume the token, set the new password,
// clear any lockout, and sign the user in.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const passwordConfirm = String(form.get("passwordConfirm") ?? "");

  const bail = (error: string) =>
    NextResponse.redirect(new URL(`/reset?token=${encodeURIComponent(token)}&error=${error}`, origin), 303);

  if (password.length < 8) return bail("short");
  if (password !== passwordConfirm) return bail("mismatch");

  const userId = await consumeResetToken(token);
  if (!userId) return NextResponse.redirect(new URL("/reset?error=invalid", origin), 303);

  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
    include: { person: true },
  });

  const name = user.person ? `${user.person.firstName} ${user.person.lastName}` : user.email;
  const jwt = await signSession({
    userId: user.id,
    email: user.email,
    role: user.role as Role,
    personId: user.personId ?? null,
    name,
  });
  const res = NextResponse.redirect(new URL(isStaff(user.role as Role) ? "/console" : "/portal", origin), 303);
  res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions);
  return res;
}
