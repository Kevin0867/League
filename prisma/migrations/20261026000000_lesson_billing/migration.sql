-- Phase 4 (per-lesson auto-charge + reminders): cron markers on a lesson booking
-- so reminders and pay-link fallbacks are each sent at most once.
ALTER TABLE "AlaCarteBooking" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "AlaCarteBooking" ADD COLUMN "payLinkSentAt" TIMESTAMP(3);
