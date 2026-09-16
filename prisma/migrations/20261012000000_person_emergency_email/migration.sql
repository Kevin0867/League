-- Emergency contact email (encrypted like the other emergency fields), now
-- required at registration alongside emergency name and phone.
ALTER TABLE "Person" ADD COLUMN "emergencyEmail" TEXT;
