-- Add a second emergency contact to Person (encrypted at the application layer).
ALTER TABLE "Person" ADD COLUMN "emergencyName2" TEXT;
ALTER TABLE "Person" ADD COLUMN "emergencyPhone2" TEXT;
ALTER TABLE "Person" ADD COLUMN "emergencyRelation2" TEXT;
