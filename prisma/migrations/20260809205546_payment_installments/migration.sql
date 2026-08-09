-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "installmentsPaid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "installmentsTotal" INTEGER,
ADD COLUMN     "stripeSubscriptionId" TEXT;
