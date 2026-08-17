-- Track when a contact was last synced to Zoho Campaigns (resumable backfill).
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "zohoSyncedAt" TIMESTAMP(3);
