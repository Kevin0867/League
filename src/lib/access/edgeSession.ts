// Edge-safe session verification for middleware. Deliberately imports ONLY
// `jose` (no "server-only", no Prisma, no bcrypt) so it runs in the edge
// runtime. Mirrors the cookie name + secret + algorithm in src/lib/auth.ts.
import { jwtVerify } from "jose";

export const SESSION_COOKIE = "pa_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");

/** Verify the session cookie and return the held roles, or null if unauthenticated. */
export async function sessionRolesFromToken(token: string | undefined | null): Promise<string[] | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const p = payload as { role?: string; roles?: unknown };
    const roles = Array.isArray(p.roles) && p.roles.length > 0 ? p.roles : p.role ? [p.role] : [];
    return roles.map((r) => String(r));
  } catch {
    return null;
  }
}
