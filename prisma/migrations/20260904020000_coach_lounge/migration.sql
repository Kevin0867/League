-- Coaches' Lounge: staff-only board (banter, announcements, sub requests).
CREATE TABLE "CoachPost" (
  "id" TEXT NOT NULL,
  "authorPersonId" TEXT,
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "notify" TEXT NOT NULL DEFAULT 'INAPP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CoachPost_pinned_createdAt_idx" ON "CoachPost"("pinned", "createdAt");

CREATE TABLE "CoachReply" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "authorPersonId" TEXT,
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CoachReply_postId_createdAt_idx" ON "CoachReply"("postId", "createdAt");
ALTER TABLE "CoachReply" ADD CONSTRAINT "CoachReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CoachPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
