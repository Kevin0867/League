-- Double-elimination support: a bracket lane on each championship match. Existing
-- single-elimination matches all belong to the winners ("W") bracket.
ALTER TABLE "ChampionshipMatch" ADD COLUMN "bracket" TEXT NOT NULL DEFAULT 'W';

-- The (round, slot) pair is only unique within a bracket now.
DROP INDEX IF EXISTS "ChampionshipMatch_seasonId_divisionId_round_slot_key";
CREATE UNIQUE INDEX "ChampionshipMatch_seasonId_divisionId_bracket_round_slot_key"
  ON "ChampionshipMatch"("seasonId", "divisionId", "bracket", "round", "slot");
