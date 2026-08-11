-- Retire a facility from selection without deleting its history.
ALTER TABLE "Facility" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
