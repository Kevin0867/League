-- Group conversations: team threads and admin threads alongside 1:1 DMs.
ALTER TABLE "Conversation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "Conversation" ADD COLUMN "teamId" TEXT;
CREATE INDEX "Conversation_teamId_idx" ON "Conversation"("teamId");
