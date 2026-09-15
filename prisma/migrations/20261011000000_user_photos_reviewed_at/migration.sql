-- Tracks when an admin last opened the Team Photos review page, so the nav can
-- badge team gallery items added since then ("new uploads to review").
ALTER TABLE "User" ADD COLUMN "photosReviewedAt" TIMESTAMP(3);
