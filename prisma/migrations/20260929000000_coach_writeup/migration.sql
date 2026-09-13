-- CreateTable
CREATE TABLE "CoachWriteup" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'NOTE',
    "notes" TEXT NOT NULL,
    "sharedWithCoachAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachWriteup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachWriteup_personId_idx" ON "CoachWriteup"("personId");
