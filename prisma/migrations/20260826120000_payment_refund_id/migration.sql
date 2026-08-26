-- Idempotency key for refund syncing: the Stripe refund id booked by an
-- OUT/REFUND payment row, so a refund (app- or dashboard-initiated) is recorded
-- exactly once.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripeRefundId_key" ON "Payment"("stripeRefundId");
