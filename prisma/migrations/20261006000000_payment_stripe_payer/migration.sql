-- Capture the Stripe payer identity (billing_details name/email) on a payment,
-- so an unattributed imported charge still shows who paid and can be applied to
-- the right player. Never card data.

ALTER TABLE "Payment"
  ADD COLUMN "stripePayerName" TEXT,
  ADD COLUMN "stripePayerEmail" TEXT;
