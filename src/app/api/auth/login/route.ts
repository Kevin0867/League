import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { effectiveRoles, primaryRole } from "@/lib/enums";

// Session login via a route handler so the Set-Cookie is reliably emitted
// (server actions can drop it on the deployed runtime). Includes brute-force
// lockout after repeated failures.
export const dynamic = "force-dynamic";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  const form = await req.formData();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const password = String(form.get("password") ?? "");
  // Only ever honor an internal path (starts with a single "/") so an open
  // redirect can't be smuggled through ?next=.
  const nextRaw = String(form.get("next") ?? "");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "";
  // Bounce back to /login preserving where they were headed AND the email they
  // typed, so a failed attempt never makes them retype it.
  const fail = (code: string) => {
    const qs = new URLSearchParams({ error: code });
    if (email) qs.set("email", email);
    if (next) qs.set("next", next);
    return to(`/login?${qs.toString()}`);
  };
  if (!email || !password) return fail("missing");

  const user = await prisma.user.findUnique({ where: { email }, include: { person: true } });
  if (!user || !user.active) return fail("invalid");
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail("locked");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const fails = user.failedLoginCount + 1;
    const locked = fails >= MAX_FAILS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: fails,
        lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    return fail(locked ? "locked" : "invalid");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const name = user.person ? `${user.person.firstName} ${user.person.lastName}` : user.email;
  const roles = effectiveRoles(user);
  const token = await signSession({
    userId: user.id,
    email: user.email,
    role: primaryRole(roles),
    roles,
    personId: user.personId ?? null,
    name,
  });
  const dest = next || (isStaff(roles) ? "/console" : "/portal");
  const res = to(dest);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
