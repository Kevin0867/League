import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Admin "Apply database updates" — brings the live database up to the schema the
// deployed code expects, over the app's own runtime connection. This is a safety
// net for the case where a deploy shipped ahead of its migration (the apparel
// tables/columns), which shows up as "table/column does not exist" 500s.
//
// The DDL is idempotent (IF NOT EXISTS / guarded constraint), and we record the
// migration in _prisma_migrations with its real checksum so a future
// `prisma migrate deploy` treats it as already applied and never re-runs it.
export const dynamic = "force-dynamic";

const APPAREL_MIGRATION = "20260813120000_team_apparel";
const APPAREL_CHECKSUM = "39ce96b4540ddb2476c1636055b80fcf1f5050b35e45421a1ae538d5e0e25ae3";

const STEPS = [
  `ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "launchedAt" TIMESTAMP(3)`,
  `ALTER TABLE "RateConfig" ADD COLUMN IF NOT EXISTS "shirtPriceCents" INTEGER NOT NULL DEFAULT 2500`,
  `ALTER TABLE "RateConfig" ADD COLUMN IF NOT EXISTS "tankPriceCents" INTEGER NOT NULL DEFAULT 2500`,
  `CREATE TABLE IF NOT EXISTS "ApparelOrderItem" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "personId" TEXT,
    "garment" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "fulfillment" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApparelOrderItem_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "ApparelOrderItem_paymentId_idx" ON "ApparelOrderItem"("paymentId")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApparelOrderItem_paymentId_fkey') THEN
      ALTER TABLE "ApparelOrderItem" ADD CONSTRAINT "ApparelOrderItem_paymentId_fkey"
        FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/system${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  try {
    for (const sql of STEPS) {
      await prisma.$executeRawUnsafe(sql);
    }
    // Record the migration as applied (guarded — only if not already recorded).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       SELECT $1, $2, now(), $3, NULL, NULL, now(), 1
       WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $3)`,
      randomUUID(),
      APPAREL_CHECKSUM,
      APPAREL_MIGRATION,
    );
    await audit({ actorId: actor.userId, entityType: "System", entityId: "db-repair", action: "DB_REPAIR", summary: "Applied pending apparel schema" });
    return back("?ok=1");
  } catch (e) {
    console.error("db-repair failed", e);
    const msg = e instanceof Error ? e.message.slice(0, 200) : "unknown error";
    return back(`?err=${encodeURIComponent(msg)}`);
  }
}
