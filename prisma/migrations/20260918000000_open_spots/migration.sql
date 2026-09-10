ALTER TABLE "Team" ADD COLUMN "acceptingSignups" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "capacity" INTEGER;

CREATE TABLE "SiteContent" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("key")
);
