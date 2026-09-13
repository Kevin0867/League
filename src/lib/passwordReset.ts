import "server-only";
import crypto from "crypto";
import { prisma } from "./db";

// Password reset tokens. Only a SHA-256 hash is stored; the raw token lives
// solely in the emailed/texted link. Tokens are single-use — once someone sets
// a password with one it's consumed and dead — and they do NOT expire on a
// clock, so a set/reset link a family holds onto still works whenever they get
// to it. (Set an explicit far-future date rather than removing the column.)
const TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000; // ~100 years = effectively no expiry

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createResetToken(userId: string, ttlMs: number = TTL_MS): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return raw;
}

/** Kept for callers that pass an explicit TTL; same non-expiring value now. */
export const INVITE_TTL_MS = TTL_MS;

/** Validate + consume a raw token, returning the userId, or null if invalid. */
export async function consumeResetToken(raw: string): Promise<string | null> {
  if (!raw) return null;
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) return null;
  await prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  return rec.userId;
}
