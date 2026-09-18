-- Per-team waitlist: people waiting for a spot on a full team. Kept off the
-- roster; promoted onto the team by an admin when a spot opens.
CREATE TABLE "TeamWaitlist" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "seasonId" TEXT,
  "note" TEXT,
  "addedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamWaitlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamWaitlist_teamId_personId_key" ON "TeamWaitlist"("teamId", "personId");
CREATE INDEX "TeamWaitlist_teamId_idx" ON "TeamWaitlist"("teamId");
