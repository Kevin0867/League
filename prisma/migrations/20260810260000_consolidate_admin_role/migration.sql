-- Consolidate the three legacy admin roles into a single ADMIN. Coach, Player,
-- and Parent are unchanged. Existing logins keep full admin access under the new
-- name.
UPDATE "User" SET role = 'ADMIN' WHERE role IN ('COO', 'CEO', 'DIRECTOR');
