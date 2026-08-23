-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "primaryHost" TEXT,
    "altHosts" JSONB,
    "logoUrl" TEXT,
    "secondaryLogoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "smsBrand" TEXT,
    "timezone" TEXT DEFAULT 'America/Phoenix',
    "currency" TEXT DEFAULT 'usd',
    "stripeAccountId" TEXT,
    "platformFeeBps" INTEGER,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_primaryHost_key" ON "Organization"("primaryHost");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- Seed the primary organization (PURE) with the platform's current identity, so
-- the app resolves to a real org from day one and nothing changes for PURE.
-- Idempotent: only inserts when no primary org exists yet.
INSERT INTO "Organization" (
    "id", "slug", "name", "legalName", "isPrimary", "status",
    "logoUrl", "secondaryLogoUrl",
    "primaryColor", "accentColor",
    "fromName", "fromEmail", "supportEmail", "smsBrand",
    "timezone", "currency",
    "updatedAt"
)
SELECT
    'org_pure_primary', 'pure', 'PURE Academy', 'PURE Pickleball & Padel', true, 'ACTIVE',
    '/brand/pure-academy-navy.png', '/brand/pure-pickleball-padel.png',
    '#2c4670', '#a9d329',
    'PURE Academy', 'team@purepickleball.com', 'team@purepickleball.com', 'PURE Academy',
    'America/Phoenix', 'usd',
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "isPrimary" = true);
