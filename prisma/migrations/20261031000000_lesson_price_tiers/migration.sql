-- Multi-person price tiers + first-lesson intro price for coach lesson offerings.
ALTER TABLE "AlaCarteOffering" ADD COLUMN "priceTiers" JSONB;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "introPriceCents" INTEGER;
