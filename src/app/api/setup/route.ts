import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

// First-admin bootstrap via a route handler (reliable Set-Cookie). Creates the
// Admin when no users exist, then signs the session onto the redirect response.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (err: string) => NextResponse.redirect(new URL(`/setup?error=${err}`, origin), 303);

  if ((await prisma.user.count()) > 0) return back("done");

  const form = await req.formData();
  const setupToken = process.env.SETUP_TOKEN;
  if (setupToken && String(form.get("token") ?? "") !== setupToken) return back("token");

  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const password = String(form.get("password") ?? "");
  if (!firstName || !lastName || !email || !password) return back("fields");
  if (password.length < 8) return back("short");

  const person = await prisma.person.create({ data: { firstName, lastName, email } });
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: "COO", personId: person.id },
  });

  const token = await signSession({
    userId: user.id,
    email: user.email,
    role: "ADMIN",
    personId: person.id,
    name: `${firstName} ${lastName}`,
  });
  const res = NextResponse.redirect(new URL("/console", origin), 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
