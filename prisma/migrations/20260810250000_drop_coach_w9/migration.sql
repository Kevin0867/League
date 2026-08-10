-- Remove W-9 / TIN capture from the CRM. Coaches complete their W-9 and are paid
-- through Gusto; the app tracks compensation and payout totals only, never a SSN/EIN.
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9Name";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9BusinessName";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9TaxClass";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9LlcClass";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9OtherClass";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9Address";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9City";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9State";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9Zip";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9TinType";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9Tin";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9TinLast4";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9SignedName";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9OnFile";
ALTER TABLE "Coach" DROP COLUMN IF EXISTS "w9ReceivedAt";
