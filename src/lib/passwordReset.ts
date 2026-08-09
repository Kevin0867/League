import "server-only";
import crypto from "crypto";
import { prisma } from "./db";

// Password reset tokens. Only a SHA-256 hash is stored; the raw token lives
// solely in the emailed link. Tokens are single-use and expire in one hour.
const TTL_MS = 60 * 60 * 1000;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createResetToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return raw;
}

/** Validate + consume a raw token, returning the userId, or null if invalid. */
export async function consumeResetToken(raw: string): Promise<string | null> {
  if (!raw) return null;
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) return null;
  await prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  return rec.userId;
}
