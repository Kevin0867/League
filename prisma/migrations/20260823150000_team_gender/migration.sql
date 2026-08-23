-- Team gender (MALE | FEMALE | COED). Additive and nullable — existing teams
-- keep NULL (treated as coed / unspecified). Adults still derive gender from the
-- division code; this is where youth (e.g. HS Boys/Girls) gender is recorded.
ALTER TABLE "Team" ADD COLUMN "gender" TEXT;
