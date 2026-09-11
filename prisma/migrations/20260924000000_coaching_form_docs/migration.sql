-- CreateTable
CREATE TABLE "CoachingFormDoc" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonId" TEXT,
    "formSlug" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingFormDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachingFormDoc_teamId_formSlug_key" ON "CoachingFormDoc"("teamId", "formSlug");

-- CreateIndex
CREATE INDEX "CoachingFormDoc_teamId_idx" ON "CoachingFormDoc"("teamId");
