-- Weekly coaching notes / progress reports: up to six one-week sections per
-- (team, student). strengths/growth are JSON string arrays of preset tag ids;
-- note is free-text; sentToParentAt records the last emailed report.
CREATE TABLE "CoachingNote" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "strengths" TEXT NOT NULL DEFAULT '[]',
    "growth" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "authorId" TEXT,
    "sentToParentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachingNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachingNote_teamId_personId_week_key" ON "CoachingNote"("teamId", "personId", "week");
CREATE INDEX "CoachingNote_personId_idx" ON "CoachingNote"("personId");
CREATE INDEX "CoachingNote_teamId_idx" ON "CoachingNote"("teamId");

ALTER TABLE "CoachingNote" ADD CONSTRAINT "CoachingNote_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachingNote" ADD CONSTRAINT "CoachingNote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
