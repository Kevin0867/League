-- Team calendar: player absences, suggested substitutes, and confirmed subs per
-- session. Plain session/person/team tags (no FKs), like other lightweight
-- session-scoped records.
CREATE TABLE "PlayerAbsence" (
  "id"        TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "teamId"    TEXT NOT NULL,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerAbsence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlayerAbsence_sessionId_personId_key" ON "PlayerAbsence"("sessionId", "personId");
CREATE INDEX "PlayerAbsence_sessionId_idx" ON "PlayerAbsence"("sessionId");
CREATE INDEX "PlayerAbsence_teamId_idx" ON "PlayerAbsence"("teamId");

CREATE TABLE "SubSuggestion" (
  "id"                  TEXT NOT NULL,
  "sessionId"           TEXT NOT NULL,
  "teamId"              TEXT NOT NULL,
  "suggestedByPersonId" TEXT,
  "name"                TEXT NOT NULL,
  "email"               TEXT,
  "phone"               TEXT,
  "status"              TEXT NOT NULL DEFAULT 'SUGGESTED',
  "addedPersonId"       TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SubSuggestion_sessionId_status_idx" ON "SubSuggestion"("sessionId", "status");

CREATE TABLE "SessionSub" (
  "id"            TEXT NOT NULL,
  "sessionId"     TEXT NOT NULL,
  "personId"      TEXT NOT NULL,
  "teamId"        TEXT NOT NULL,
  "addedByUserId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionSub_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionSub_sessionId_personId_key" ON "SessionSub"("sessionId", "personId");
CREATE INDEX "SessionSub_sessionId_idx" ON "SessionSub"("sessionId");
