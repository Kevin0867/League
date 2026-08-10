-- Additional coaches on a team (beyond the head coach on Team.coachId).
CREATE TABLE "TeamCoach" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ASSISTANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamCoach_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamCoach_teamId_coachId_key" ON "TeamCoach"("teamId", "coachId");
CREATE INDEX "TeamCoach_coachId_idx" ON "TeamCoach"("coachId");
ALTER TABLE "TeamCoach" ADD CONSTRAINT "TeamCoach_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamCoach" ADD CONSTRAINT "TeamCoach_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
