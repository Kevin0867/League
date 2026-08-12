-- Optional per-address labels (a person's name / relationship) so a sender can
-- choose, per email, exactly which addresses on a player's record receive it.
ALTER TABLE "Person" ADD COLUMN "emailLabel" TEXT;
ALTER TABLE "Person" ADD COLUMN "email2Label" TEXT;
ALTER TABLE "Person" ADD COLUMN "email3Label" TEXT;
