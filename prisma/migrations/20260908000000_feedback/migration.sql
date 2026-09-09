-- Season feedback / testimonials from families, optionally tied to a coach.
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "personId" TEXT,
    "respondentName" TEXT,
    "coachId" TEXT,
    "rating" INTEGER,
    "body" TEXT,
    "consentPublish" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "phase" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Feedback_coachId_published_idx" ON "Feedback"("coachId", "published");
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
