-- Phase 6 (phone-calendar busy-import): cached busy intervals parsed from a
-- coach's external calendar feed. Rewritten each sync; the slot engine
-- subtracts them so lessons aren't offered over a coach's other commitments.
CREATE TABLE "CoachBusyBlock" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "uid" TEXT,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachBusyBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoachBusyBlock_coachId_startAt_idx" ON "CoachBusyBlock"("coachId", "startAt");

ALTER TABLE "CoachBusyBlock" ADD CONSTRAINT "CoachBusyBlock_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
