-- Resync upcoming practice locations with each team's current home facility.
--
-- Each practice (Session) stores its own facilityId, snapshotted from the team
-- when practices were generated. Changing a team's facility never updated those
-- rows, so the calendar (which reads Session.facilityId) could show the old
-- facility while the team page shows the new one.
--
-- Fix the drift for FUTURE practices only (past practices are historical record)
-- and only for single-team practices whose team has a facility set — so shared
-- sessions and teams without a facility are left untouched. A one-off relocation
-- (relocatedFacilityId) still wins in the calendar regardless of this base value.
UPDATE "Session" s
SET "facilityId" = t."facilityId"
FROM "SessionTeam" st
JOIN "Team" t ON t.id = st."teamId"
WHERE st."sessionId" = s.id
  AND s.type = 'PRACTICE'
  AND s.date >= CURRENT_DATE
  AND t."facilityId" IS NOT NULL
  AND s."facilityId" IS DISTINCT FROM t."facilityId"
  AND (SELECT COUNT(*) FROM "SessionTeam" st2 WHERE st2."sessionId" = s.id) = 1;
