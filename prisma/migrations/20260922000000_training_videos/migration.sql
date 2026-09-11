CREATE TABLE "TrainingVideo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "skillLevel" TEXT,
    "videoUrl" TEXT NOT NULL,
    "videoType" TEXT DEFAULT 'VIDEO',
    "visibleToPlayers" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingVideo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrainingVideo_visibleToPlayers_createdAt_idx" ON "TrainingVideo"("visibleToPlayers", "createdAt");
CREATE INDEX "TrainingVideo_category_idx" ON "TrainingVideo"("category");
