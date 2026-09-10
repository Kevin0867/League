-- Digital coaching agreements: coach-signed + admin countersigned, retained.
CREATE TABLE "CoachingAgreement" (
  "id" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "seasonId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "assignment" JSONB,
  "coachName" TEXT,
  "coachEmail" TEXT,
  "coachPhone" TEXT,
  "coachSignature" TEXT,
  "coachSignedAt" TIMESTAMP(3),
  "adminName" TEXT,
  "adminTitle" TEXT,
  "adminSignedById" TEXT,
  "adminSignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoachingAgreement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CoachingAgreement_coachId_idx" ON "CoachingAgreement"("coachId");
CREATE INDEX "CoachingAgreement_status_idx" ON "CoachingAgreement"("status");
ALTER TABLE "CoachingAgreement" ADD CONSTRAINT "CoachingAgreement_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoachingAgreement" ADD CONSTRAINT "CoachingAgreement_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
