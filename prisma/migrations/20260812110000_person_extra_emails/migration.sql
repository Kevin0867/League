-- Additional notification addresses on a person (up to three total), so both
-- parents and a minor with their own email can all receive updates, and the
-- guardian email captured on a minor's waiver is always retained.
ALTER TABLE "Person" ADD COLUMN "email2" TEXT;
ALTER TABLE "Person" ADD COLUMN "email3" TEXT;
