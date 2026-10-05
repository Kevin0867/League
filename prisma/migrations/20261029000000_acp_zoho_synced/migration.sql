-- Track Zoho mailing-list sync for ACP entries + roster players, so they sync
-- like season registrations and the backfill can resume where it left off.
ALTER TABLE "AcpEntry" ADD COLUMN "zohoSyncedAt" TIMESTAMP(3);
ALTER TABLE "AcpEntryPlayer" ADD COLUMN "zohoSyncedAt" TIMESTAMP(3);
