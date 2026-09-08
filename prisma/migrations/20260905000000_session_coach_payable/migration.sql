-- Per-session pay follows whoever actually covers the class. A substitute
-- assignment flips the normal coach's row to payable=false for that one session.
ALTER TABLE "SessionCoach" ADD COLUMN "payable" BOOLEAN NOT NULL DEFAULT true;
