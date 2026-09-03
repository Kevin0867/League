-- Free-text note for a payment settled outside Stripe (check, Class Wallet, cash,
-- in-kind). Records HOW an offline payment was made.
ALTER TABLE "Payment" ADD COLUMN "manualNote" TEXT;
