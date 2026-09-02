-- Connect a standalone apparel order to the team the gear is for, so the
-- fulfillment report shows who and where even when the buyer isn't on that
-- roster. Null for season-fee apparel (team comes from the player's TeamMember).
ALTER TABLE "Payment" ADD COLUMN "apparelTeamId" TEXT;
