-- CreateTable
CREATE TABLE "SmsRoute" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "personId" TEXT,
    "senderPersonId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsRoute_phone_key" ON "SmsRoute"("phone");

-- CreateIndex
CREATE INDEX "SmsRoute_senderPersonId_idx" ON "SmsRoute"("senderPersonId");
