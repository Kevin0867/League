-- Phase 2 of the lessons suite: court-time reservations so a lesson can't collide
-- with a practice, match, or another lesson at the same facility + time.
CREATE TABLE "CourtHold" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "courtCount" INTEGER NOT NULL DEFAULT 1,
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "note" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourtHold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CourtHold_facilityId_date_idx" ON "CourtHold"("facilityId", "date");
ALTER TABLE "CourtHold" ADD CONSTRAINT "CourtHold_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
