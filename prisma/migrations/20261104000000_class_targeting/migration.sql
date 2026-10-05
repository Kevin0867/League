-- Targeted classes & clinics: audience targeting on an offering, plus a
-- ClassSession child table for multi-session (multi-week) classes.

ALTER TABLE "AlaCarteOffering"
  ADD COLUMN "targetMinRating" DOUBLE PRECISION,
  ADD COLUMN "targetMaxRating" DOUBLE PRECISION,
  ADD COLUMN "targetGender" TEXT,
  ADD COLUMN "targetAgeGroup" TEXT;

CREATE TABLE "ClassSession" (
  "id" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "lengthMin" INTEGER,
  "facilityId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassSession_offeringId_scheduledAt_idx" ON "ClassSession"("offeringId", "scheduledAt");

ALTER TABLE "ClassSession"
  ADD CONSTRAINT "ClassSession_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "AlaCarteOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
