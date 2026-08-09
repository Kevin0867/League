import { NextResponse } from "next/server";
import { authenticate, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

// Session login via a route handler so the Set-Cookie is reliably emitted
// (server actions can drop it on the deployed runtime). Plain form POST →
// authenticate → set cookie on the redirect response.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  if (!email || !password) {
    return NextResponse.redirect(new URL("/login?error=missing", origin), 303);
  }

  const session = await authenticate(email, password);
  if (!session) {
    return NextResponse.redirect(new URL("/login?error=invalid", origin), 303);
  }

  const token = await signSession(session);
  const dest = isStaff(session.role) ? "/console" : "/portal";
  const res = NextResponse.redirect(new URL(dest, origin), 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
