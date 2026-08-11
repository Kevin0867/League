-- Publish a coach on the public /coaches page (off by default).
ALTER TABLE "Coach" ADD COLUMN "publishedOnSite" BOOLEAN NOT NULL DEFAULT false;
