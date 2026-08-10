-- Data fix: opensOn was seeded equal to the season start date, which wrongly
-- blocked public registration until the season began. opensOn gates the
-- registration form, not the season start — clear it so registration is open
-- now. Only touches PURE Academy seasons where opensOn was set to the start date.
UPDATE "Season"
SET "opensOn" = NULL
WHERE "program" = 'PURE_ACADEMY'
  AND "opensOn" IS NOT NULL
  AND "opensOn" = "startDate";
