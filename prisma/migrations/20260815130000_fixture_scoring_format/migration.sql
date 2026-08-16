-- Composable per-match scoring format (serve type, points-to, win-by-2,
-- rally-freeze threshold, and games-to-win).
ALTER TABLE "Fixture" ADD COLUMN "serveType" TEXT NOT NULL DEFAULT 'SIDE_OUT';
ALTER TABLE "Fixture" ADD COLUMN "pointsTo" INTEGER NOT NULL DEFAULT 11;
ALTER TABLE "Fixture" ADD COLUMN "winByTwo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Fixture" ADD COLUMN "freezeAt" INTEGER;
ALTER TABLE "Fixture" ADD COLUMN "gamesToWin" INTEGER NOT NULL DEFAULT 2;
