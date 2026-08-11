-- Team identity as separate parts; the display name is rendered from these.
ALTER TABLE "Team" ADD COLUMN "club" TEXT NOT NULL DEFAULT 'PURE';
ALTER TABLE "Team" ADD COLUMN "divisionCode" TEXT;
ALTER TABLE "Team" ADD COLUMN "color" TEXT;
CREATE INDEX "Team_club_market_divisionCode_idx" ON "Team"("club", "market", "divisionCode");
