-- Track when a team was launched (combined welcome + apparel/pay + waiver email
-- sent to the roster), so the Teams page can show Launched / Ready to launch.
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "launchedAt" TIMESTAMP(3);
