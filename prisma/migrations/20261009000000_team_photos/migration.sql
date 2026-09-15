-- Team photo/video gallery: memories and action shots added by coaches,
-- players, and admins, separate from training videos, homework, and facility
-- photos.
CREATE TABLE "TeamPhoto" (
  "id"           TEXT NOT NULL,
  "teamId"       TEXT NOT NULL,
  "uploaderId"   TEXT,
  "uploaderName" TEXT,
  "url"          TEXT NOT NULL,
  "type"         TEXT NOT NULL DEFAULT 'IMAGE',
  "caption"      TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamPhoto_teamId_createdAt_idx" ON "TeamPhoto"("teamId", "createdAt");

ALTER TABLE "TeamPhoto" ADD CONSTRAINT "TeamPhoto_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
