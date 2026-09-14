-- Player-portal feedback: who may see it, and an optional attachment.
ALTER TABLE "Feedback" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'ADMINS';
ALTER TABLE "Feedback" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "Feedback" ADD COLUMN "attachmentType" TEXT;
CREATE INDEX "Feedback_coachId_visibility_idx" ON "Feedback"("coachId", "visibility");
