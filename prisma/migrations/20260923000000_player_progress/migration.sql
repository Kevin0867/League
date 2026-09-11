CREATE TABLE "PlayerProgressEntry" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "seasonId" TEXT,
    "week" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerProgressEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlayerProgressEntry_teamId_personId_week_metric_key" ON "PlayerProgressEntry"("teamId", "personId", "week", "metric");
CREATE INDEX "PlayerProgressEntry_teamId_metric_idx" ON "PlayerProgressEntry"("teamId", "metric");
CREATE INDEX "PlayerProgressEntry_personId_metric_idx" ON "PlayerProgressEntry"("personId", "metric");
