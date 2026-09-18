-- Court rent the Academy pays a facility, per court per hour, with a night rate
-- (after courtNightStartsAt) for venues that charge more in the evening. Pulled
-- into the P&L as this location's court cost.
ALTER TABLE "Facility" ADD COLUMN "courtCostDayCents" INTEGER;
ALTER TABLE "Facility" ADD COLUMN "courtCostNightCents" INTEGER;
ALTER TABLE "Facility" ADD COLUMN "courtNightStartsAt" TEXT DEFAULT '17:00';
