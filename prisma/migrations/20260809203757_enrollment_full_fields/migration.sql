-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "address" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "howHeard" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "enrollmentFeeCents" INTEGER,
ADD COLUMN     "importRaw" JSONB,
ADD COLUMN     "minorNames" TEXT,
ADD COLUMN     "perClassRateCents" INTEGER,
ADD COLUMN     "schedule" TEXT,
ADD COLUMN     "sourceStatus" TEXT,
ADD COLUMN     "stripePaymentMethod" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;
