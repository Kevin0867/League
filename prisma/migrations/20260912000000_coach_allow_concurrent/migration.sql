-- Allow specific coaches to be assigned to teams with overlapping day/time.
ALTER TABLE "Coach" ADD COLUMN "allowConcurrentTeams" BOOLEAN NOT NULL DEFAULT false;
