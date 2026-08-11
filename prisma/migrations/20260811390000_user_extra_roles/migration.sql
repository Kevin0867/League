-- Additional roles a user holds beyond their primary role (multi-role support).
ALTER TABLE "User" ADD COLUMN "extraRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
