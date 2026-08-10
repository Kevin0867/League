-- Coach compensation (admin-only): rate and/or percentage per work type.
ALTER TABLE "Coach" ADD COLUMN "seasonPayCents" INTEGER;
ALTER TABLE "Coach" ADD COLUMN "seasonPayPct" INTEGER;
ALTER TABLE "Coach" ADD COLUMN "lessonPayCents" INTEGER;
ALTER TABLE "Coach" ADD COLUMN "lessonPayPct" INTEGER;
ALTER TABLE "Coach" ADD COLUMN "clinicPayCents" INTEGER;
ALTER TABLE "Coach" ADD COLUMN "clinicPayPct" INTEGER;
ALTER TABLE "Coach" ADD COLUMN "payNotes" TEXT;
