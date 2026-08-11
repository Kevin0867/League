-- Explicit league membership. Decouples the league roster from a team's own
-- season/division so any published team can be added to the active ACP league.
CREATE TABLE "LeagueTeam" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueTeam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeagueTeam_seasonId_teamId_key" ON "LeagueTeam"("seasonId", "teamId");
CREATE INDEX "LeagueTeam_seasonId_idx" ON "LeagueTeam"("seasonId");
CREATE INDEX "LeagueTeam_teamId_idx" ON "LeagueTeam"("teamId");

ALTER TABLE "LeagueTeam" ADD CONSTRAINT "LeagueTeam_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueTeam" ADD CONSTRAINT "LeagueTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every team already living in an ACP season is an existing league
-- member, so current fixtures and leaderboards keep working after the switch to
-- explicit membership.
INSERT INTO "LeagueTeam" ("id", "seasonId", "teamId", "createdAt")
SELECT 'lt_' || t."id", t."seasonId", t."id", CURRENT_TIMESTAMP
FROM "Team" t
JOIN "Season" s ON s."id" = t."seasonId"
WHERE s."program" = 'ACP'
ON CONFLICT ("seasonId", "teamId") DO NOTHING;
