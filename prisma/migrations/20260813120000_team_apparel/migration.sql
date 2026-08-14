-- Team apparel prices on the rate config (both default to $25.00).
ALTER TABLE "RateConfig" ADD COLUMN "shirtPriceCents" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "RateConfig" ADD COLUMN "tankPriceCents" INTEGER NOT NULL DEFAULT 2500;

-- Apparel order lines bundled with a season-fee payment.
CREATE TABLE "ApparelOrderItem" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "personId" TEXT,
    "garment" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "fulfillment" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApparelOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApparelOrderItem_paymentId_idx" ON "ApparelOrderItem"("paymentId");

ALTER TABLE "ApparelOrderItem" ADD CONSTRAINT "ApparelOrderItem_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
