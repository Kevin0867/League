-- Phase 1 of the private/group lessons suite: coach-set "Private/Group lesson
-- pricing" offerings, dated availability exceptions, and the coach's external
-- calendar subscribe URL (for later busy-import).

-- AlaCarteOffering: a COACH-set offering isn't pinned to a single venue, and
-- carries the lesson shape (length, group size, preferred locations, recurrence)
-- plus an optional admin price override.
ALTER TABLE "AlaCarteOffering" ALTER COLUMN "facilityId" DROP NOT NULL;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "adminLockedPriceCents" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "coachSet" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "lengthMin" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "minPeople" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "maxPeople" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "preferredFacilityIds" JSONB;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "recurrenceAllowed" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "AlaCarteOffering_coachId_idx" ON "AlaCarteOffering"("coachId");

-- Coach: their own phone/work calendar subscribe URL (busy-import in Phase 6).
ALTER TABLE "Coach" ADD COLUMN "externalCalendarUrl" TEXT;

-- Dated overrides to a coach's recurring weekly availability.
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'BLOCK',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilityException_coachId_date_idx" ON "AvailabilityException"("coachId", "date");
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
