-- Photo/video attachments for messages, lounge posts, and broadcasts.
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentType" TEXT;

ALTER TABLE "CoachPost" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "CoachPost" ADD COLUMN "attachmentType" TEXT;

ALTER TABLE "Message" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN "attachmentType" TEXT;
