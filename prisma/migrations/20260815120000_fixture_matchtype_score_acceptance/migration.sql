-- League match format + score-acceptance workflow on fixtures.
ALTER TABLE "Fixture" ADD COLUMN "matchType" TEXT NOT NULL DEFAULT 'TEAM_3';
ALTER TABLE "Fixture" ADD COLUMN "scoreStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Fixture" ADD COLUMN "scoreProposedById" TEXT;
ALTER TABLE "Fixture" ADD COLUMN "scoreProposedAt" TIMESTAMP(3);
ALTER TABLE "Fixture" ADD COLUMN "scoreAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Fixture" ADD COLUMN "scoreNote" TEXT;
