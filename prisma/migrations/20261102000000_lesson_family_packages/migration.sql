-- Sibling/family discount + prepaid lesson packages on coach offerings.
ALTER TABLE "AlaCarteOffering" ADD COLUMN "additionalPersonDiscountPct" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "packages" JSONB;
