-- Per-coach calendar subscription token (secret feed URL).
ALTER TABLE "Coach" ADD COLUMN "calendarToken" TEXT;
CREATE UNIQUE INDEX "Coach_calendarToken_key" ON "Coach"("calendarToken");

-- Editable season arc, stored as JSON (null = show the standard template).
ALTER TABLE "Season" ADD COLUMN "calendar" JSONB;
