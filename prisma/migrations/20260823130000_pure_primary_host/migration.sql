-- Pin the primary org (PURE) to its production hostname so tenant resolution is
-- deterministic once other orgs exist. Idempotent: only sets it when unset, and
-- never overwrites a host an admin has already configured.
UPDATE "Organization"
SET "primaryHost" = 'academy.purepickleball.com',
    "altHosts" = '["www.academy.purepickleball.com"]'::jsonb
WHERE "isPrimary" = true AND "primaryHost" IS NULL;
