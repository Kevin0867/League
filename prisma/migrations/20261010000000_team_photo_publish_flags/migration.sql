-- Publish flags for team gallery items: show on the public site gallery
-- (/gallery) and/or on the team's public page (/teams/[slug]). Set by staff.
ALTER TABLE "TeamPhoto" ADD COLUMN "onWebsite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamPhoto" ADD COLUMN "onTeamPage" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "TeamPhoto_onWebsite_idx" ON "TeamPhoto"("onWebsite");
