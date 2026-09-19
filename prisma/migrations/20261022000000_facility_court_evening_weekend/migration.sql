-- Court rent tiers: rename Night → Evening and add a Weekend flat rate.
ALTER TABLE "Facility" RENAME COLUMN "courtCostNightCents" TO "courtCostEveningCents";
ALTER TABLE "Facility" RENAME COLUMN "courtNightStartsAt" TO "courtEveningStartsAt";
ALTER TABLE "Facility" ADD COLUMN "courtCostWeekendCents" INTEGER;
