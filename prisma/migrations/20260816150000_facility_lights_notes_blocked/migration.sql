-- Facility lighting + operational notes, and a kind on court blocks so a window
-- can mark recurring unavailable (blocked) times as well as open availability.
ALTER TABLE "Facility" ADD COLUMN "lights" TEXT;
ALTER TABLE "Facility" ADD COLUMN "notes" TEXT;
ALTER TABLE "CourtBlock" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'AVAILABLE';
