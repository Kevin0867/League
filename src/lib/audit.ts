import "server-only";
import { prisma } from "./db";

/**
 * Audit trail on assignments, cancellations, waivers, and payments (§18).
 * Keep it best-effort — an audit write must never block the primary action.
 */
export async function audit(input: {
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary?: string;
  metadata?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        summary: input.summary,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (e) {
    console.error("audit write failed", e);
  }
}
