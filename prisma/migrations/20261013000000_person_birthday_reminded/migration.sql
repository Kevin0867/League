-- Idempotency for the daily birthday-reminder cron: the YYYY-MM-DD birthday
-- occurrence a coach was last reminded about for this player.
ALTER TABLE "Person" ADD COLUMN "birthdayRemindedOn" TEXT;
