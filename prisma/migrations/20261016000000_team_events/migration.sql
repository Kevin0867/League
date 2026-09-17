-- Team-added calendar events (team dinners, extra hits, socials). Distinct from
-- Session (no coaching pay / attendance / auto-close). Plain teamId tag, no FK,
-- like the other lightweight calendar records.
CREATE TABLE "TeamEvent" (
  "id"                TEXT NOT NULL,
  "teamId"            TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "description"       TEXT,
  "location"          TEXT,
  "date"              TIMESTAMP(3) NOT NULL,
  "startTime"         TEXT,
  "endTime"           TEXT,
  "createdByPersonId" TEXT,
  "createdByName"     TEXT,
  "createdByRole"     TEXT NOT NULL DEFAULT 'PLAYER',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeamEvent_teamId_date_idx" ON "TeamEvent"("teamId", "date");
