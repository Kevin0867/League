-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PLAYER',
    "personId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "email" TEXT,
    "phone" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "duprId" TEXT,
    "duprRating" DOUBLE PRECISION,
    "duprVerified" BOOLEAN NOT NULL DEFAULT false,
    "duprVerifiedAt" TIMESTAMP(3),
    "duprParentalConsent" BOOLEAN NOT NULL DEFAULT false,
    "waiverSignedAt" TIMESTAMP(3),
    "mediaOptOut" BOOLEAN NOT NULL DEFAULT false,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "guardianId" TEXT,
    "medicalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "recruitedByCoachId" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "divisionId" TEXT,
    "skillLevel" TEXT,
    "duprRatingAtReg" DOUBLE PRECISION,
    "practiceTimePref" TEXT,
    "daysThatDontWork" TEXT,
    "partnerRequests" TEXT,
    "medicalDisclosures" TEXT,
    "mediaOptOut" BOOLEAN NOT NULL DEFAULT false,
    "isCoachRegistration" BOOLEAN NOT NULL DEFAULT false,
    "feeWaived" BOOLEAN NOT NULL DEFAULT false,
    "recruitedByCoachId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "mergedIntoId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPreference" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "facilityId" TEXT,
    "marketName" TEXT,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "LocationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "divisionId" TEXT,
    "levelBand" TEXT,
    "market" TEXT,
    "coachId" TEXT,
    "teamContactId" TEXT,
    "facilityId" TEXT,
    "dayOfWeek" TEXT,
    "startTime" TEXT,
    "coachPlays" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'PURE_ACADEMY',
    "clubName" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "forfeitCount" INTEGER NOT NULL DEFAULT 0,
    "champEligible" BOOLEAN NOT NULL DEFAULT true,
    "eligibilityOverrideById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "roleOnTeam" TEXT NOT NULL DEFAULT 'PLAYER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coach" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "rpoCertLevel" TEXT,
    "backgroundCheckDate" TIMESTAMP(3),
    "backgroundCheckExpiry" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "marketsCovered" TEXT,
    "isProCoach" BOOLEAN NOT NULL DEFAULT false,
    "w9OnFile" BOOLEAN NOT NULL DEFAULT false,
    "w9ReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityBlock" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "dayOfWeek" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "AvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market" TEXT,
    "courtCount" INTEGER NOT NULL DEFAULT 0,
    "agreementStatus" TEXT NOT NULL DEFAULT 'IDENTIFIED',
    "feeBasis" TEXT NOT NULL DEFAULT 'NONE',
    "weekdayRateCents" INTEGER NOT NULL DEFAULT 0,
    "weekendRateCents" INTEGER NOT NULL DEFAULT 0,
    "percentageRate" DOUBLE PRECISION,
    "paymentTerms" TEXT,
    "primaryContact" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "generalArea" TEXT,
    "exactAddress" TEXT,
    "accessInstructions" TEXT,
    "alaCarteAllowed" BOOLEAN NOT NULL DEFAULT false,
    "acpLeagueOption" BOOLEAN NOT NULL DEFAULT false,
    "acpHeldCourts" INTEGER,
    "acpConfirmBy" TIMESTAMP(3),
    "championshipHostInterest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtBlock" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "dayOfWeek" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "courtCount" INTEGER NOT NULL DEFAULT 1,
    "overrideNonExecuted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CourtBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutDate" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "BlackoutDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "facilityId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "courtCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "cancelReason" TEXT,
    "relocatedFacilityId" TEXT,
    "weekNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTeam" (
    "sessionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "SessionTeam_pkey" PRIMARY KEY ("sessionId","teamId")
);

-- CreateTable
CREATE TABLE "SessionCoach" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "paidIfCancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SessionCoach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "partyId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'STRIPE',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "category" TEXT NOT NULL,
    "seasonId" TEXT,
    "sessionId" TEXT,
    "stripeCheckoutId" TEXT,
    "stripePaymentIntentId" TEXT,
    "installmentPlan" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateConfig" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "seasonFeeCents" INTEGER NOT NULL DEFAULT 49500,
    "coachPerSessionCents" INTEGER NOT NULL DEFAULT 10000,
    "assistantPct" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "proCoachPerSessionCents" INTEGER,
    "alaCoachSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "alaDirectorSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "alaPurePct" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "alaDirCoachSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "alaDirDirectorSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "alaDirPurePct" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRun" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachPayoutLine" (
    "id" TEXT NOT NULL,
    "payoutRunId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "sessionsDelivered" INTEGER NOT NULL DEFAULT 0,
    "sessionPayCents" INTEGER NOT NULL DEFAULT 0,
    "alaCarteCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoachPayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityStatement" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sessionsDelivered" INTEGER NOT NULL DEFAULT 0,
    "onSiteRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "amountDueCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "program" TEXT NOT NULL DEFAULT 'PURE_ACADEMY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "opensOn" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "divisionType" TEXT NOT NULL DEFAULT 'DUPR_BAND',
    "minRating" DOUBLE PRECISION,
    "maxRating" DOUBLE PRECISION,
    "bandsLocked" BOOLEAN NOT NULL DEFAULT false,
    "bandsLockedAt" TIMESTAMP(3),

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "facilityId" TEXT,
    "courtAllocation" TEXT,
    "arrivalInstructions" TEXT,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "forfeitedById" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineMatchup" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "isCounting" BOOLEAN NOT NULL DEFAULT true,
    "homePairingId" TEXT,
    "awayPairingId" TEXT,
    "lineWinner" TEXT,

    CONSTRAINT "LineMatchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameScore" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "homeScore" INTEGER NOT NULL DEFAULT 0,
    "awayScore" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GameScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pairing" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "playerAId" TEXT NOT NULL,
    "playerBId" TEXT NOT NULL,
    "combinedDupr" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityConfirmation" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "AvailabilityConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RescheduleRequest" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "requestedByTeamId" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RescheduleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuprSubmission" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuprSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlaCarteOffering" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "coachId" TEXT,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlaCarteOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlaCarteBooking" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "coachId" TEXT,
    "directorTaught" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "courtCostCents" INTEGER NOT NULL DEFAULT 0,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "coachCents" INTEGER NOT NULL DEFAULT 0,
    "directorCents" INTEGER NOT NULL DEFAULT 0,
    "pureCents" INTEGER NOT NULL DEFAULT 0,
    "appliedCoachPct" DOUBLE PRECISION,
    "appliedDirectorPct" DOUBLE PRECISION,
    "appliedPurePct" DOUBLE PRECISION,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlaCarteBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "seasonId" TEXT,
    "audienceType" TEXT NOT NULL,
    "audienceRef" TEXT,
    "channels" TEXT NOT NULL DEFAULT 'IN_APP,EMAIL',
    "triggerType" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRecipient" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "inAppStatus" TEXT NOT NULL DEFAULT 'QUEUED',
    "emailStatus" TEXT,
    "smsStatus" TEXT,
    "readAt" TIMESTAMP(3),
    "failedReason" TEXT,

    CONSTRAINT "MessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waiver" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "seasonId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "signatureName" TEXT NOT NULL,
    "mediaConsent" BOOLEAN NOT NULL DEFAULT true,
    "parentalConsent" BOOLEAN NOT NULL DEFAULT false,
    "documentVersion" TEXT,

    CONSTRAINT "Waiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- CreateIndex
CREATE INDEX "Person_lastName_firstName_idx" ON "Person"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Person_email_idx" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_phone_idx" ON "Person"("phone");

-- CreateIndex
CREATE INDEX "Registration_seasonId_divisionId_status_idx" ON "Registration"("seasonId", "divisionId", "status");

-- CreateIndex
CREATE INDEX "Registration_personId_idx" ON "Registration"("personId");

-- CreateIndex
CREATE INDEX "LocationPreference_registrationId_rank_idx" ON "LocationPreference"("registrationId", "rank");

-- CreateIndex
CREATE INDEX "Team_seasonId_divisionId_idx" ON "Team"("seasonId", "divisionId");

-- CreateIndex
CREATE INDEX "Team_coachId_idx" ON "Team"("coachId");

-- CreateIndex
CREATE INDEX "TeamMember_personId_idx" ON "TeamMember"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_personId_key" ON "TeamMember"("teamId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "Coach_personId_key" ON "Coach"("personId");

-- CreateIndex
CREATE INDEX "AvailabilityBlock_coachId_idx" ON "AvailabilityBlock"("coachId");

-- CreateIndex
CREATE INDEX "Facility_market_idx" ON "Facility"("market");

-- CreateIndex
CREATE INDEX "Facility_agreementStatus_idx" ON "Facility"("agreementStatus");

-- CreateIndex
CREATE INDEX "CourtBlock_facilityId_idx" ON "CourtBlock"("facilityId");

-- CreateIndex
CREATE INDEX "BlackoutDate_date_idx" ON "BlackoutDate"("date");

-- CreateIndex
CREATE INDEX "Session_seasonId_date_idx" ON "Session"("seasonId", "date");

-- CreateIndex
CREATE INDEX "Session_status_idx" ON "Session"("status");

-- CreateIndex
CREATE INDEX "SessionCoach_coachId_idx" ON "SessionCoach"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCoach_sessionId_coachId_key" ON "SessionCoach"("sessionId", "coachId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_sessionId_personId_key" ON "Attendance"("sessionId", "personId");

-- CreateIndex
CREATE INDEX "Payment_direction_category_status_idx" ON "Payment"("direction", "category", "status");

-- CreateIndex
CREATE INDEX "Payment_partyId_idx" ON "Payment"("partyId");

-- CreateIndex
CREATE INDEX "CoachPayoutLine_coachId_idx" ON "CoachPayoutLine"("coachId");

-- CreateIndex
CREATE INDEX "FacilityStatement_facilityId_periodStart_idx" ON "FacilityStatement"("facilityId", "periodStart");

-- CreateIndex
CREATE INDEX "Division_seasonId_idx" ON "Division"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Fixture_sessionId_key" ON "Fixture"("sessionId");

-- CreateIndex
CREATE INDEX "Fixture_seasonId_weekNumber_idx" ON "Fixture"("seasonId", "weekNumber");

-- CreateIndex
CREATE INDEX "Fixture_status_idx" ON "Fixture"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LineMatchup_fixtureId_lineNumber_key" ON "LineMatchup"("fixtureId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GameScore_lineId_gameNumber_key" ON "GameScore"("lineId", "gameNumber");

-- CreateIndex
CREATE INDEX "Pairing_teamId_weekNumber_idx" ON "Pairing"("teamId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityConfirmation_fixtureId_personId_key" ON "AvailabilityConfirmation"("fixtureId", "personId");

-- CreateIndex
CREATE INDEX "RescheduleRequest_fixtureId_idx" ON "RescheduleRequest"("fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "DuprSubmission_fixtureId_key" ON "DuprSubmission"("fixtureId");

-- CreateIndex
CREATE INDEX "AlaCarteOffering_facilityId_idx" ON "AlaCarteOffering"("facilityId");

-- CreateIndex
CREATE INDEX "AlaCarteBooking_clientId_idx" ON "AlaCarteBooking"("clientId");

-- CreateIndex
CREATE INDEX "AlaCarteBooking_coachId_idx" ON "AlaCarteBooking"("coachId");

-- CreateIndex
CREATE INDEX "Message_audienceType_audienceRef_idx" ON "Message"("audienceType", "audienceRef");

-- CreateIndex
CREATE INDEX "Message_triggerType_idx" ON "Message"("triggerType");

-- CreateIndex
CREATE INDEX "MessageRecipient_personId_idx" ON "MessageRecipient"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageRecipient_messageId_personId_key" ON "MessageRecipient"("messageId", "personId");

-- CreateIndex
CREATE INDEX "Waiver_personId_idx" ON "Waiver"("personId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_recruitedByCoachId_fkey" FOREIGN KEY ("recruitedByCoachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_recruitedByCoachId_fkey" FOREIGN KEY ("recruitedByCoachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPreference" ADD CONSTRAINT "LocationPreference_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPreference" ADD CONSTRAINT "LocationPreference_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamContactId_fkey" FOREIGN KEY ("teamContactId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coach" ADD CONSTRAINT "Coach_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackoutDate" ADD CONSTRAINT "BlackoutDate_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeam" ADD CONSTRAINT "SessionTeam_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeam" ADD CONSTRAINT "SessionTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCoach" ADD CONSTRAINT "SessionCoach_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachPayoutLine" ADD CONSTRAINT "CoachPayoutLine_payoutRunId_fkey" FOREIGN KEY ("payoutRunId") REFERENCES "PayoutRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachPayoutLine" ADD CONSTRAINT "CoachPayoutLine_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityStatement" ADD CONSTRAINT "FacilityStatement_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Division" ADD CONSTRAINT "Division_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineMatchup" ADD CONSTRAINT "LineMatchup_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameScore" ADD CONSTRAINT "GameScore_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "LineMatchup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_playerAId_fkey" FOREIGN KEY ("playerAId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_playerBId_fkey" FOREIGN KEY ("playerBId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityConfirmation" ADD CONSTRAINT "AvailabilityConfirmation_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityConfirmation" ADD CONSTRAINT "AvailabilityConfirmation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescheduleRequest" ADD CONSTRAINT "RescheduleRequest_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuprSubmission" ADD CONSTRAINT "DuprSubmission_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlaCarteOffering" ADD CONSTRAINT "AlaCarteOffering_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlaCarteOffering" ADD CONSTRAINT "AlaCarteOffering_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlaCarteBooking" ADD CONSTRAINT "AlaCarteBooking_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "AlaCarteOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlaCarteBooking" ADD CONSTRAINT "AlaCarteBooking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlaCarteBooking" ADD CONSTRAINT "AlaCarteBooking_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
