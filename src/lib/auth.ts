import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { Role } from "./enums";

const COOKIE = "pa_session";
export const SESSION_COOKIE = COOKIE;
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-secret-change-me"
);

/** Cookie options shared by server-action and route-handler session writes. */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

/** Sign a session JWT (for setting the cookie on a route-handler response). */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export type SessionPayload = {
  userId: string;
  email: string;
  role: Role;
  personId: string | null;
  name: string;
};

/**
 * On this runtime the httpOnly session cookie is reliably present on GET
 * navigations (server components can read it) but is NOT delivered on POSTs to
 * route handlers — an authenticated form POST arrives with no cookies at all.
 * To authorize a mutating POST we therefore mint a short-lived signed "action
 * ticket" server-side while rendering the page (where the session IS readable),
 * embed it as a hidden form field, and verify the ticket on POST instead of
 * relying on the cookie. The ticket travels in the request body, so it always
 * arrives.
 */
export type ActionTicket = {
  userId: string;
  role: Role;
  scope: string;
};

export async function signActionTicket(
  t: ActionTicket,
  ttlSeconds = 60 * 30
): Promise<string> {
  return new SignJWT({ ...t, kind: "action" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyActionTicket(
  token: string | undefined | null,
  scope: string
): Promise<ActionTicket | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind !== "action" || payload.scope !== scope) return null;
    return {
      userId: String(payload.userId),
      role: payload.role as Role,
      scope: String(payload.scope),
    };
  } catch {
    return null;
  }
}

/**
 * Console mutations run as POSTs, where this runtime does not deliver the
 * session cookie. Pages mint a console ticket while rendering (a GET, where the
 * session IS readable) and embed it in a hidden form field; the action then
 * resolves the actor from that ticket, falling back to the cookie session when
 * present (e.g. local dev). Returns just the identity + role the RBAC checks
 * need.
 */
const CONSOLE_SCOPE = "console";

export async function mintConsoleTicket(): Promise<string> {
  const s = await getSession();
  return s
    ? signActionTicket({ userId: s.userId, role: s.role, scope: CONSOLE_SCOPE })
    : "";
}

export async function actorFromForm(
  formData: FormData
): Promise<{ userId: string; role: Role } | null> {
  const t = await verifyActionTicket(formData.get("ticket")?.toString(), CONSOLE_SCOPE);
  if (t) return { userId: t.userId, role: t.role };
  const s = await getSession();
  return s ? { userId: s.userId, role: s.role } : null;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Authenticate credentials and return a session payload, or null. */
export async function authenticate(
  email: string,
  password: string
): Promise<SessionPayload | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { person: true },
  });
  if (!user || !user.active) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const name = user.person
    ? `${user.person.firstName} ${user.person.lastName}`
    : user.email;

  return {
    userId: user.id,
    email: user.email,
    role: user.role as Role,
    personId: user.personId ?? null,
    name,
  };
}
