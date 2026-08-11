-- Consolidated family season-fee invoice: which players a single payment covers.
ALTER TABLE "Payment" ADD COLUMN "coveredPersonIds" JSONB;
