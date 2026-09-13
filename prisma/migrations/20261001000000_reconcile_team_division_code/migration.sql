-- Reconcile teams whose stored display name embeds an explicit division code
-- (e.g. "PURE Gilbert W3.5 Green") that disagrees with the divisionCode field
-- used for grouping/color audits. The team edit form updated the name and level
-- but historically never rewrote divisionCode, so a renamed or re-leveled team
-- could keep a stale code and file under the wrong band (a 3.5 team under 3.0).
--
-- Only touches teams whose name contains a canonical M/W band token that differs
-- from the stored code; word-form names (no "W3.5" token) are left untouched and
-- are corrected the next time the team is saved (the update now recomputes it).
UPDATE "Team"
SET "divisionCode" = m.code
FROM (
  SELECT id, substring("name" from '([MW][0-9][.][0-9][+]?)') AS code
  FROM "Team"
) m
WHERE "Team".id = m.id
  AND m.code IS NOT NULL
  AND "Team"."divisionCode" IS DISTINCT FROM m.code;
