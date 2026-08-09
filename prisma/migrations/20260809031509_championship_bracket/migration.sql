-- CreateTable
CREATE TABLE "ChampionshipMatch" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "homeSeed" INTEGER,
    "awaySeed" INTEGER,
    "winnerTeamId" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChampionshipMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChampionshipMatch_seasonId_divisionId_idx" ON "ChampionshipMatch"("seasonId", "divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionshipMatch_seasonId_divisionId_round_slot_key" ON "ChampionshipMatch"("seasonId", "divisionId", "round", "slot");
