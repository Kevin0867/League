import "server-only";
import { SignJWT, jwtVerify } from "jose";

// A player/parent taps a texted link to check themselves in when they arrive at
// practice. The link carries a short-lived signed token that names the exact
// (session, player) so no login is needed and the token can't be repurposed.
// See /checkin/[token] and /api/checkin.

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const SCOPE = "session-checkin";

export type CheckinClaims = { sessionId: string; personId: string };

/** Sign a check-in link token. Short TTL — it's only useful around class time. */
export async function signCheckinToken(
  sessionId: string,
  personId: string,
  ttlHours = 12,
): Promise<string> {
  return new SignJWT({ sessionId, personId, scope: SCOPE, kind: "checkin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlHours * 3600)
    .sign(secret);
}

export async function verifyCheckinToken(
  token: string | undefined | null,
): Promise<CheckinClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind !== "checkin" || payload.scope !== SCOPE) return null;
    const sessionId = String(payload.sessionId ?? "");
    const personId = String(payload.personId ?? "");
    if (!sessionId || !personId) return null;
    return { sessionId, personId };
  } catch {
    return null;
  }
}
