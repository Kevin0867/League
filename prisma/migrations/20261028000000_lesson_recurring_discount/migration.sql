-- Optional recurring-series discount (whole-number %) on a coach-set lesson
-- offering. priceCents is per person; this is applied per lesson when booked as
-- a recurring series.
ALTER TABLE "AlaCarteOffering" ADD COLUMN "recurringDiscountPct" INTEGER;
