-- Per-offering booking rules for private/group lessons.
ALTER TABLE "AlaCarteOffering" ADD COLUMN "minNoticeHours" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "bookingHorizonDays" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "bufferMin" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "dailyCap" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "cancelWindowHours" INTEGER;
ALTER TABLE "AlaCarteOffering" ADD COLUMN "cancelPolicy" TEXT;
