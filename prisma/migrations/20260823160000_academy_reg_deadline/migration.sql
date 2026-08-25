-- Registration deadline for the PURE Academy: end of Sept 1, 2026 (Arizona,
-- UTC-7 year-round) = 2026-09-02 06:59:59 UTC. After this instant the public
-- form stays open but files new sign-ups onto the WAITLIST. Applied to the
-- active Academy season(s); admins can still change it in Season Setup.
UPDATE "Season"
SET "closesOn" = TIMESTAMP '2026-09-02 06:59:59'
WHERE program = 'PURE_ACADEMY' AND active = true;
