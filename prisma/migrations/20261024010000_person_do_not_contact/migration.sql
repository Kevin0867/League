-- Hard do-not-contact switch per person: when true, no automated/broadcast
-- email or SMS is sent to them (honored in dispatchMessage and reminder jobs).
ALTER TABLE "Person" ADD COLUMN "doNotContact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Person" ADD COLUMN "doNotContactAt" TIMESTAMP(3);
