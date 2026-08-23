-- CreateTable
CREATE TABLE "SponsorBenefit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorshipPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "inventory" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorshipPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorshipPackageBenefit" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,

    CONSTRAINT "SponsorshipPackageBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "packageId" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROSPECT',
    "benefitsNote" TEXT,
    "notes" TEXT,
    "securedById" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorBenefit_organizationId_active_idx" ON "SponsorBenefit"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Sponsor_organizationId_idx" ON "Sponsor"("organizationId");

-- CreateIndex
CREATE INDEX "SponsorshipPackage_organizationId_scopeType_scopeId_idx" ON "SponsorshipPackage"("organizationId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorshipPackageBenefit_packageId_benefitId_key" ON "SponsorshipPackageBenefit"("packageId", "benefitId");

-- CreateIndex
CREATE INDEX "SponsorshipPackageBenefit_benefitId_idx" ON "SponsorshipPackageBenefit"("benefitId");

-- CreateIndex
CREATE INDEX "Sponsorship_organizationId_scopeType_scopeId_idx" ON "Sponsorship"("organizationId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "Sponsorship_sponsorId_idx" ON "Sponsorship"("sponsorId");

-- AddForeignKey
ALTER TABLE "SponsorshipPackageBenefit" ADD CONSTRAINT "SponsorshipPackageBenefit_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SponsorshipPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorshipPackageBenefit" ADD CONSTRAINT "SponsorshipPackageBenefit_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "SponsorBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SponsorshipPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the customizable benefit catalog with starter placeholders for the
-- primary org — only when it has none yet. Every one of these is editable and
-- removable in the console; this is just a starting point, not a fixed set.
INSERT INTO "SponsorBenefit" ("id", "organizationId", "label", "description", "active", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, org.id, b.label, b.description, true, b.ord, CURRENT_TIMESTAMP
FROM (SELECT id FROM "Organization" WHERE "isPrimary" = true LIMIT 1) org
CROSS JOIN (VALUES
    (1,  'Logo on team jerseys & apparel', 'Sponsor mark printed on the team''s uniforms and warmups.'),
    (2,  'Banner / signage at matches & events', 'Physical banner or court signage displayed at games and events.'),
    (3,  'Named title sponsor ("presented by")', 'The league, tournament, or team is presented by the sponsor.'),
    (4,  'Social media shout-outs', 'Recurring sponsor features across the organization''s social channels.'),
    (5,  'Website listing with link', 'Logo and link on the public website / team page.'),
    (6,  'Logo on schedule & standings pages', 'Sponsor placement on the live schedule and standings.'),
    (7,  'PA / court announcements at events', 'Read-aloud sponsor recognition during matches and events.'),
    (8,  'Email newsletter feature', 'Dedicated mention in the email newsletter to members and families.'),
    (9,  'Booth or table at events', 'On-site space to engage attendees at key events.'),
    (10, 'Logo on printed programs & flyers', 'Sponsor mark on printed programs, brackets, and flyers.'),
    (11, 'Sponsor spotlight / thank-you post', 'A dedicated feature post thanking and introducing the sponsor.'),
    (12, 'Product sampling or giveaways', 'Sponsor products or promo items distributed to participants.')
) AS b(ord, label, description)
WHERE NOT EXISTS (SELECT 1 FROM "SponsorBenefit" sb WHERE sb."organizationId" = org.id);
