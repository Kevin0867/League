-- Non-production flags so rehearsal seasons/teams stay out of public pages,
-- pickers, and counts.
ALTER TABLE "Season" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
