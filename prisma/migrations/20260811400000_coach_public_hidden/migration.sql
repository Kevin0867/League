-- Per-field public-profile visibility for a coach (empty = show everything).
ALTER TABLE "Coach" ADD COLUMN "publicHidden" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
