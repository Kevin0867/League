-- Phase 3: player-booked lessons — recurring series + per-occurrence venue/length
-- and the per-lesson payment link on each booking.

ALTER TABLE "AlaCarteBooking" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "AlaCarteBooking" ADD COLUMN "lessonLengthMin" INTEGER;
ALTER TABLE "AlaCarteBooking" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "AlaCarteBooking" ADD COLUMN "paymentId" TEXT;
CREATE INDEX "AlaCarteBooking_seriesId_idx" ON "AlaCarteBooking"("seriesId");

CREATE TABLE "LessonSeries" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "coachId" TEXT,
    "clientId" TEXT NOT NULL,
    "facilityId" TEXT,
    "cadence" TEXT NOT NULL DEFAULT 'ONCE',
    "intervalN" INTEGER NOT NULL DEFAULT 1,
    "endType" TEXT NOT NULL DEFAULT 'ONCE',
    "endDate" TIMESTAMP(3),
    "count" INTEGER,
    "people" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,
    "defaultPaymentMethodId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonSeries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LessonSeries_clientId_idx" ON "LessonSeries"("clientId");
CREATE INDEX "LessonSeries_coachId_idx" ON "LessonSeries"("coachId");

ALTER TABLE "LessonSeries" ADD CONSTRAINT "LessonSeries_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "AlaCarteOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonSeries" ADD CONSTRAINT "LessonSeries_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LessonSeries" ADD CONSTRAINT "LessonSeries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AlaCarteBooking" ADD CONSTRAINT "AlaCarteBooking_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "LessonSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
