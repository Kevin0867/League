-- Add the "fill this team" target-team tag to registrations.
ALTER TABLE "Registration" ADD COLUMN "targetTeamId" TEXT;
