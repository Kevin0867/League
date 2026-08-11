-- Express opt-in timestamps on the person.
ALTER TABLE "Person" ADD COLUMN "emailConsentAt" TIMESTAMP(3);
ALTER TABLE "Person" ADD COLUMN "smsConsentAt" TIMESTAMP(3);

-- Auditable consent records (TCPA / Twilio A2P proof of opt-in).
CREATE TABLE "MessagingConsent" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "emailOptIn" BOOLEAN NOT NULL DEFAULT false,
    "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessagingConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessagingConsent_createdAt_idx" ON "MessagingConsent"("createdAt");
CREATE INDEX "MessagingConsent_phone_idx" ON "MessagingConsent"("phone");
