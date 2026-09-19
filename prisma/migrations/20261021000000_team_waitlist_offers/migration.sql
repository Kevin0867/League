-- Waitlist offer state: when a spot opens the 1st person is OFFERED the spot
-- with a 24h deadline and a public accept/decline token; if it lapses it rolls
-- to the next person.
ALTER TABLE "TeamWaitlist" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'WAITING';
ALTER TABLE "TeamWaitlist" ADD COLUMN "offeredAt" TIMESTAMP(3);
ALTER TABLE "TeamWaitlist" ADD COLUMN "offerExpiresAt" TIMESTAMP(3);
ALTER TABLE "TeamWaitlist" ADD COLUMN "offerToken" TEXT;
CREATE UNIQUE INDEX "TeamWaitlist_offerToken_key" ON "TeamWaitlist"("offerToken");
