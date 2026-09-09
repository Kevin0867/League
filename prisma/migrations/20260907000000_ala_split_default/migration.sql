-- Assigned-coach à-la-carte split now matches director-teaches: 60/10/30.
ALTER TABLE "RateConfig" ALTER COLUMN "alaCoachSharePct" SET DEFAULT 0.6;
ALTER TABLE "RateConfig" ALTER COLUMN "alaPurePct" SET DEFAULT 0.3;
