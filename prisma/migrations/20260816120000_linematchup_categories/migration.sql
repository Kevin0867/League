-- Categorized club-match lines: category + rank + optional label, and the two
-- players each side fields (stored by id, names resolved from rosters).
ALTER TABLE "LineMatchup" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "LineMatchup" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LineMatchup" ADD COLUMN "label" TEXT;
ALTER TABLE "LineMatchup" ADD COLUMN "homePlayer1Id" TEXT;
ALTER TABLE "LineMatchup" ADD COLUMN "homePlayer2Id" TEXT;
ALTER TABLE "LineMatchup" ADD COLUMN "awayPlayer1Id" TEXT;
ALTER TABLE "LineMatchup" ADD COLUMN "awayPlayer2Id" TEXT;
