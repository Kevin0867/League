-- Idempotency key for externally-originated chat messages (Twilio inbound-SMS
-- MessageSid). Unique so a re-delivered webhook can't create a duplicate
-- message. Nullable — app-composed messages leave it null, and Postgres allows
-- many nulls under a unique index.
ALTER TABLE "ChatMessage" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "ChatMessage_externalId_key" ON "ChatMessage"("externalId");
