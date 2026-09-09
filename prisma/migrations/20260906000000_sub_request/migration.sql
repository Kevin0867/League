-- Coach substitute requests: created by a class's coach, claimable by other coaches.
CREATE TABLE "SubRequest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestedByCoachId" TEXT NOT NULL,
    "claimedByCoachId" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubRequest_status_createdAt_idx" ON "SubRequest"("status", "createdAt");
CREATE INDEX "SubRequest_sessionId_idx" ON "SubRequest"("sessionId");

ALTER TABLE "SubRequest" ADD CONSTRAINT "SubRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
