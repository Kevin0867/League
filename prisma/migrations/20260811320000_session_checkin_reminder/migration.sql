-- Tracks when the ~15-min-before check-in reminder text was sent for a session.
ALTER TABLE "Session" ADD COLUMN "checkinReminderSentAt" TIMESTAMP(3);
