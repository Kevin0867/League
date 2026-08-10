-- Digital W-9 for contractor coaches. TIN stored encrypted at rest; last-4 clear.
ALTER TABLE "Coach" ADD COLUMN "w9Name" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9BusinessName" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9TaxClass" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9LlcClass" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9OtherClass" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9Address" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9City" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9State" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9Zip" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9TinType" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9Tin" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9TinLast4" TEXT;
ALTER TABLE "Coach" ADD COLUMN "w9SignedName" TEXT;
