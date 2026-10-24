-- Season-level mute for automated player/guardian session reminders.
ALTER TABLE "Season" ADD COLUMN "playerRemindersOff" BOOLEAN NOT NULL DEFAULT false;

-- Honor the standing request to mute player session reminders for the current
-- live PURE Academy season now that ACP match play has started on a different
-- schedule. One-time; fully reversible from Console → Season setup. Matches no
-- rows in a fresh/empty environment, so it is safe to apply everywhere.
UPDATE "Season" SET "playerRemindersOff" = true
 WHERE "program" = 'PURE_ACADEMY' AND "active" = true AND "isTest" = false;
