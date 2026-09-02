-- Explicit "send all new registrations to the waitlist now" switch, independent
-- of the close date.
ALTER TABLE "Season" ADD COLUMN "waitlistMode" BOOLEAN NOT NULL DEFAULT false;
