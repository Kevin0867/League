-- Phase-A outside-club interest before ACP entries open.
CREATE TABLE "AcpInterest" (
    "id" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "market" TEXT,
    "likelyTeams" INTEGER,
    "likelyDivisions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcpInterest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AcpInterest_createdAt_idx" ON "AcpInterest"("createdAt");
