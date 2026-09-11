-- Practices are 2 hours. Some sessions were generated at 90 minutes; reset every
-- practice session's end time to exactly 2 hours after its (correct) start time.
-- Only well-formed HH:MM start times are touched.
UPDATE "Session"
SET "endTime" = to_char(("startTime"::time + interval '2 hours'), 'HH24:MI')
WHERE "type" = 'PRACTICE'
  AND "startTime" ~ '^[0-9]{1,2}:[0-9]{2}$';
