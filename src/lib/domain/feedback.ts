import "server-only";
import { SignJWT, jwtVerify } from "jose";

// Signed, tokenized link for the season feedback / testimonial form, so a family
// can respond from a text or email with no login. Encodes who and which season/
// phase so a submission is attributed and we can offer their coaches.

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const SCOPE = "feedback";

export type FeedbackTokenData = { personId: string; seasonId: string | null; phase: string };

export async function signFeedbackToken(personId: string, seasonId: string | null, phase: string, ttlDays = 60): Promise<string> {
  return new SignJWT({ personId, seasonId: seasonId ?? "", phase, scope: SCOPE, kind: "feedback" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlDays * 86400)
    .sign(secret);
}

export async function verifyFeedbackToken(token: string | undefined | null): Promise<FeedbackTokenData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind !== "feedback" || payload.scope !== SCOPE) return null;
    return {
      personId: String(payload.personId),
      seasonId: payload.seasonId ? String(payload.seasonId) : null,
      phase: String(payload.phase ?? "GENERAL"),
    };
  } catch {
    return null;
  }
}
