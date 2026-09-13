-- AlterTable
ALTER TABLE "Person" ADD COLUMN "calendarToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Person_calendarToken_key" ON "Person"("calendarToken");
