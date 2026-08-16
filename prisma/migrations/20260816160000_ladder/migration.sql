-- Ladder competition: entries ranked by position, positions swap on an upset.
CREATE TABLE "Ladder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ladder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LadderEntry" (
    "id" TEXT NOT NULL,
    "ladderId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LadderEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LadderEntry_ladderId_position_idx" ON "LadderEntry"("ladderId", "position");

ALTER TABLE "LadderEntry" ADD CONSTRAINT "LadderEntry_ladderId_fkey"
    FOREIGN KEY ("ladderId") REFERENCES "Ladder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
