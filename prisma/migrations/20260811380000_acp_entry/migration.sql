-- ACP outside-club entries (Phase B) and their rosters.
CREATE TABLE "AcpEntry" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "clubName" TEXT NOT NULL,
    "market" TEXT,
    "divisionName" TEXT NOT NULL,
    "divisionCode" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "playerCount" INTEGER NOT NULL,
    "amountDueCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcpEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AcpEntry_createdAt_idx" ON "AcpEntry"("createdAt");
CREATE INDEX "AcpEntry_status_idx" ON "AcpEntry"("status");

CREATE TABLE "AcpEntryPlayer" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "duprId" TEXT,
    "duprRating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcpEntryPlayer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AcpEntryPlayer_entryId_idx" ON "AcpEntryPlayer"("entryId");
ALTER TABLE "AcpEntryPlayer" ADD CONSTRAINT "AcpEntryPlayer_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AcpEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
