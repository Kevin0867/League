import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptionExtension } from "../src/lib/prisma-encryption";

// Use the encrypted client so seeded emergency/medical fields are stored
// encrypted, exactly like real writes.
const prisma = new PrismaClient().$extends(encryptionExtension);

const DEMO_PASSWORD = "pickleball";

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

function d(iso: string) {
  return new Date(iso + "T12:00:00.000Z");
}

async function main() {
  console.log("Clearing existing data…");
  // Order matters for FK integrity.
  await prisma.gameScore.deleteMany();
  await prisma.lineMatchup.deleteMany();
  await prisma.duprSubmission.deleteMany();
  await prisma.rescheduleRequest.deleteMany();
  await prisma.availabilityConfirmation.deleteMany();
  await prisma.pairing.deleteMany();
  await prisma.fixture.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.sessionCoach.deleteMany();
  await prisma.sessionTeam.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.locationPreference.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.waiver.deleteMany();
  await prisma.availabilityBlock.deleteMany();
  await prisma.courtBlock.deleteMany();
  await prisma.blackoutDate.deleteMany();
  await prisma.facilityStatement.deleteMany();
  await prisma.coachPayoutLine.deleteMany();
  await prisma.payoutRun.deleteMany();
  await prisma.alaCarteBooking.deleteMany();
  await prisma.alaCarteOffering.deleteMany();
  await prisma.messageRecipient.deleteMany();
  await prisma.message.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.division.deleteMany();
  await prisma.coach.deleteMany();
  await prisma.user.deleteMany();
  await prisma.person.deleteMany();
  await prisma.season.deleteMany();
  await prisma.rateConfig.deleteMany();

  console.log("Seeding rate config…");
  await prisma.rateConfig.create({ data: {} }); // defaults per spec

  console.log("Seeding seasons & divisions…");
  const season = await prisma.season.create({
    data: {
      name: "PURE Academy — Fall 2026",
      program: "PURE_ACADEMY",
      startDate: d("2026-09-14"),
      endDate: d("2026-12-13"),
      opensOn: d("2026-09-14"),
      active: true,
    },
  });
  const acpSeason = await prisma.season.create({
    data: {
      name: "Arizona Club Pickleball — Fall 2026",
      program: "ACP",
      startDate: d("2026-10-26"),
      endDate: d("2026-12-13"),
      active: true,
    },
  });

  const divYouthMS = await prisma.division.create({ data: { seasonId: season.id, name: "Youth — Middle School", divisionType: "SCHOOL_LEVEL" } });
  const divYouthHS = await prisma.division.create({ data: { seasonId: season.id, name: "Youth — High School", divisionType: "SCHOOL_LEVEL" } });
  const divAdult30 = await prisma.division.create({ data: { seasonId: season.id, name: "Adult 3.0–3.5", divisionType: "DUPR_BAND", minRating: 3.0, maxRating: 3.5 } });
  const divAdult40 = await prisma.division.create({ data: { seasonId: season.id, name: "Adult 4.0–4.5", divisionType: "DUPR_BAND", minRating: 4.0, maxRating: 4.5 } });
  // ACP divisions
  const acpAdult35 = await prisma.division.create({ data: { seasonId: acpSeason.id, name: "ACP Adult 3.5", divisionType: "DUPR_BAND", minRating: 3.5, maxRating: 4.0 } });

  console.log("Seeding blackout dates (Thanksgiving week is dark)…");
  for (let day = 23; day <= 29; day++) {
    await prisma.blackoutDate.create({
      data: { date: d(`2026-11-${day}`), reason: "Thanksgiving week — no play (§6)" },
    });
  }

  console.log("Seeding facilities…");
  const facScottsdale = await prisma.facility.create({
    data: {
      name: "Scottsdale Ranch Pickleball Complex", market: "Scottsdale", courtCount: 8,
      agreementStatus: "EXECUTED", feeBasis: "PER_HOUR", weekdayRateCents: 3000, weekendRateCents: 4000,
      paymentTerms: "Net 15", primaryContact: "Dana Ruiz", contactEmail: "dana@srpc.example",
      alaCarteAllowed: true, acpLeagueOption: true, acpHeldCourts: 4, acpConfirmBy: d("2026-10-19"),
      championshipHostInterest: true, generalArea: "North Scottsdale",
    },
  });
  const facGilbert = await prisma.facility.create({
    data: {
      name: "Gilbert Regional Courts", market: "Gilbert", courtCount: 6,
      agreementStatus: "AGREEMENT_SENT", feeBasis: "PER_SESSION", weekdayRateCents: 12000, weekendRateCents: 15000,
      paymentTerms: "Net 15", primaryContact: "Marco Diaz", alaCarteAllowed: false, generalArea: "Gilbert",
    },
  });
  const facPrivate = await prisma.facility.create({
    data: {
      name: "Warner Residence Court", market: "Chandler", courtCount: 1,
      agreementStatus: "EXECUTED", feeBasis: "NONE",
      isPrivate: true, generalArea: "South Chandler",
      exactAddress: "Released to assigned players only", accessInstructions: "Gate code shared after assignment",
      alaCarteAllowed: false,
    },
  });
  const facMesa = await prisma.facility.create({
    data: {
      name: "Mesa Grande Athletic Club", market: "Mesa", courtCount: 10,
      agreementStatus: "VERBAL", feeBasis: "PERCENTAGE", percentageRate: 0.15,
      primaryContact: "Priya Shah", alaCarteAllowed: true, generalArea: "Mesa",
    },
  });

  console.log("Seeding staff…");
  async function makeStaff(first: string, last: string, email: string, role: string) {
    const person = await prisma.person.create({ data: { firstName: first, lastName: last, email } });
    await prisma.user.create({ data: { email, passwordHash: await hash(DEMO_PASSWORD), role, personId: person.id } });
    return person;
  }
  await makeStaff("Brett", "Warner", "coo@purepickleball.com", "COO");
  await makeStaff("Alex", "Nguyen", "ceo@purepickleball.com", "CEO");
  const director = await makeStaff("Jordan", "Blake", "director@purepickleball.com", "DIRECTOR");

  console.log("Seeding coaches…");
  async function makeCoach(
    first: string, last: string, email: string,
    opts: { cleared: boolean; pro?: boolean }
  ) {
    const person = await prisma.person.create({ data: { firstName: first, lastName: last, email, duprId: `DUPR-${last.toUpperCase()}`, duprRating: 4.5, duprVerified: true } });
    await prisma.user.create({ data: { email, passwordHash: await hash(DEMO_PASSWORD), role: "COACH", personId: person.id } });
    const coach = await prisma.coach.create({
      data: {
        personId: person.id, rpoCertLevel: "RPO Level 2", isProCoach: opts.pro ?? false, w9OnFile: opts.cleared,
        backgroundCheckDate: opts.cleared ? d("2026-06-01") : null,
        backgroundCheckExpiry: opts.cleared ? d("2027-06-01") : null,
        onboardingCompletedAt: opts.cleared ? d("2026-07-15") : null,
        marketsCovered: JSON.stringify(["Scottsdale", "Mesa"]),
      },
    });
    await prisma.availabilityBlock.create({ data: { coachId: coach.id, dayOfWeek: "TUE", startTime: "17:00", endTime: "20:00" } });
    return { person, coach };
  }
  const coachSam = await makeCoach("Sam", "Carter", "sam.coach@purepickleball.com", { cleared: true });
  const coachLee = await makeCoach("Lee", "Okafor", "lee.coach@purepickleball.com", { cleared: false }); // screening incomplete → gated

  console.log("Seeding players / parents & registrations…");
  async function makePlayer(
    first: string, last: string, email: string | null,
    opts: { division: string; dupr?: string; rating?: number; waiver?: boolean; login?: boolean; phone?: string; minor?: boolean; emergency?: { name: string; phone: string; relation: string }; medical?: string }
  ) {
    const person = await prisma.person.create({
      data: {
        firstName: first, lastName: last, email, phone: opts.phone,
        duprId: opts.dupr ?? null, duprRating: opts.rating ?? null, isMinor: opts.minor ?? false,
        waiverSignedAt: opts.waiver ? d("2026-08-20") : null,
        // Encrypted-at-rest by the client extension.
        emergencyName: opts.emergency?.name ?? null,
        emergencyPhone: opts.emergency?.phone ?? null,
        emergencyRelation: opts.emergency?.relation ?? null,
        medicalNotes: opts.medical ?? null,
      },
    });
    if (opts.login && email) {
      await prisma.user.create({ data: { email, passwordHash: await hash(DEMO_PASSWORD), role: "PLAYER", personId: person.id } });
    }
    if (opts.waiver) {
      await prisma.waiver.create({ data: { personId: person.id, seasonId: season.id, signedAt: d("2026-08-20"), signatureName: `${first} ${last}`, mediaConsent: true } });
    }
    const reg = await prisma.registration.create({
      data: {
        personId: person.id, seasonId: season.id, divisionId: opts.division,
        duprRatingAtReg: opts.rating ?? null, status: "SUBMITTED", practiceTimePref: "weeknight",
      },
    });
    await prisma.locationPreference.create({ data: { registrationId: reg.id, facilityId: facScottsdale.id, rank: 1 } });
    await prisma.locationPreference.create({ data: { registrationId: reg.id, facilityId: facMesa.id, rank: 2 } });
    return person;
  }

  const p1 = await makePlayer("Emma", "Johnson", "emma.player@example.com", { division: divAdult40.id, dupr: "DUPR-EJOHN", rating: 4.2, waiver: true, login: true, phone: "480-555-0101", emergency: { name: "Dana Johnson", phone: "480-555-0199", relation: "Spouse" } });
  const p2 = await makePlayer("Liam", "Johnson", "liam.player@example.com", { division: divAdult40.id, dupr: "DUPR-LJOHN", rating: 4.1, waiver: true, phone: "480-555-0102" });
  await makePlayer("Olivia", "Martinez", "olivia@example.com", { division: divAdult40.id, dupr: "DUPR-OMART", rating: 4.3, waiver: true });
  await makePlayer("Noah", "Williams", "noah@example.com", { division: divAdult40.id, dupr: "DUPR-NWILL", rating: 4.0, waiver: false }); // waiver outstanding
  await makePlayer("Ava", "Brown", "ava@example.com", { division: divAdult30.id, rating: 3.2, waiver: true });
  await makePlayer("Mason", "Davis", "mason@example.com", { division: divAdult30.id, rating: 3.4, waiver: true });
  await makePlayer("Sophia", "Garcia", "sophia@example.com", { division: divYouthHS.id, waiver: true, minor: true, emergency: { name: "Maria Garcia", phone: "480-555-0177", relation: "Mother" }, medical: "Mild peanut allergy — carries an EpiPen." });

  // Duplicate: same person, two registrations (name + phone match) — demonstrates dedup
  await makePlayer("Emma", "Johnson", null, { division: divAdult40.id, waiver: false, phone: "480-555-0101" });

  console.log("Seeding teams…");
  // A complete, publishable PURE team at an executed facility.
  const teamA = await prisma.team.create({
    data: {
      name: "Scottsdale Smash", seasonId: season.id, divisionId: divAdult40.id, levelBand: "4.0–4.5",
      market: "Scottsdale", coachId: coachSam.coach.id, teamContactId: coachSam.person.id,
      facilityId: facScottsdale.id, dayOfWeek: "TUE", startTime: "18:00",
      origin: "PURE_ACADEMY", published: true, publishedAt: d("2026-08-25"),
    },
  });
  await prisma.teamMember.create({ data: { teamId: teamA.id, personId: p1.id, roleOnTeam: "PLAYER" } });
  await prisma.teamMember.create({ data: { teamId: teamA.id, personId: p2.id, roleOnTeam: "PLAYER" } });
  await prisma.registration.updateMany({ where: { personId: { in: [p1.id, p2.id] } }, data: { status: "ASSIGNED" } });

  // A team still building (missing facility day/time) at a not-yet-executed facility.
  await prisma.team.create({
    data: {
      name: "Gilbert Grinders", seasonId: season.id, divisionId: divAdult30.id, levelBand: "3.0–3.5",
      market: "Gilbert", coachId: coachSam.coach.id, facilityId: facGilbert.id,
      origin: "PURE_ACADEMY", published: false,
    },
  });

  // An outside ACP club team — no coach, a captain instead (must be supported).
  const captain = await prisma.person.create({ data: { firstName: "Riley", lastName: "Fox", email: "captain@acpclub.example", duprId: "DUPR-RFOX", duprRating: 3.7, duprVerified: true } });
  const teamAcp = await prisma.team.create({
    data: {
      name: "Tempe Titans (ACP)", seasonId: acpSeason.id, divisionId: acpAdult35.id, levelBand: "3.5",
      market: "Tempe", teamContactId: captain.id, facilityId: facScottsdale.id, dayOfWeek: "SUN", startTime: "10:00",
      origin: "ACP_CLUB", clubName: "Tempe Titans PB Club", published: true,
    },
  });

  console.log("Seeding sessions & a season-fee payment request…");
  const s1 = await prisma.session.create({
    data: {
      seasonId: season.id, type: "PRACTICE", facilityId: facScottsdale.id,
      date: d("2026-09-15"), startTime: "18:00", endTime: "19:30", courtCount: 2,
      status: "SCHEDULED", weekNumber: 1,
    },
  });
  await prisma.sessionTeam.create({ data: { sessionId: s1.id, teamId: teamA.id } });
  await prisma.sessionCoach.create({ data: { sessionId: s1.id, coachId: coachSam.coach.id, role: "PRIMARY" } });

  // Payment requested AFTER assignment (§8) — the published sequence.
  await prisma.payment.create({
    data: {
      direction: "IN", partyId: p1.id, amountCents: 49500, method: "STRIPE", status: "REQUESTED",
      category: "PLAYER_FEE", seasonId: season.id, description: "Fall 2026 season fee — Scottsdale Smash",
    },
  });
  await prisma.payment.create({
    data: {
      direction: "IN", partyId: p2.id, amountCents: 49500, method: "STRIPE", status: "PAID",
      category: "PLAYER_FEE", seasonId: season.id, description: "Fall 2026 season fee — Scottsdale Smash",
      paidAt: d("2026-09-01"),
    },
  });

  console.log("Seeding à la carte offerings…");
  await prisma.alaCarteOffering.create({
    data: { type: "PRIVATE", title: "60-min private lesson", facilityId: facScottsdale.id, coachId: coachSam.coach.id, priceCents: 9000 },
  });
  await prisma.alaCarteOffering.create({
    data: { type: "CLINIC", title: "Saturday skills clinic", facilityId: facMesa.id, coachId: coachSam.coach.id, priceCents: 4500 },
  });
  await prisma.alaCarteBooking.create({
    data: { offeringId: (await prisma.alaCarteOffering.findFirstOrThrow({ where: { type: "PRIVATE" } })).id, clientId: p1.id, coachId: coachSam.coach.id, status: "REQUESTED" },
  });

  console.log("Seeding an ACP fixture with line scores (for standings)…");
  const teamAcp2 = await prisma.team.create({
    data: {
      name: "Mesa Mavericks (ACP)", seasonId: acpSeason.id, divisionId: acpAdult35.id, levelBand: "3.5",
      market: "Mesa", teamContactId: captain.id, facilityId: facScottsdale.id, dayOfWeek: "SUN", startTime: "10:00",
      origin: "ACP_CLUB", clubName: "Mesa Mavericks", published: true,
    },
  });
  const fixture = await prisma.fixture.create({
    data: {
      seasonId: acpSeason.id, weekNumber: 7, scheduledAt: d("2026-10-26"),
      facilityId: facScottsdale.id, homeTeamId: teamAcp.id, awayTeamId: teamAcp2.id,
      status: "COMPLETED", courtAllocation: "Courts 1–4",
    },
  });
  // Three counting lines + game scores. Home takes lines 1 and 3.
  const lineScores = [
    { line: 1, counting: true, games: [[11, 7], [11, 9]] },
    { line: 2, counting: true, games: [[8, 11], [9, 11]] },
    { line: 3, counting: true, games: [[11, 5], [7, 11], [11, 8]] },
    { line: 4, counting: false, games: [[11, 6], [11, 4]] }, // exhibition, non-counting
  ];
  for (const ls of lineScores) {
    const line = await prisma.lineMatchup.create({
      data: { fixtureId: fixture.id, lineNumber: ls.line, isCounting: ls.counting },
    });
    for (let i = 0; i < ls.games.length; i++) {
      await prisma.gameScore.create({
        data: { lineId: line.id, gameNumber: i + 1, homeScore: ls.games[i][0], awayScore: ls.games[i][1] },
      });
    }
  }
  await prisma.duprSubmission.create({ data: { fixtureId: fixture.id, status: "SUBMITTED", attempts: 1, submittedAt: d("2026-10-27") } });

  console.log("Seeding a broadcast message log…");
  const cooUser = await prisma.user.findFirst({ where: { role: "COO" } });
  const msg = await prisma.message.create({
    data: {
      senderId: cooUser?.id, seasonId: season.id, audienceType: "TEAM", audienceRef: teamA.id,
      channels: "IN_APP,EMAIL", triggerType: "TEAM_ASSIGNMENT", subject: "You're on Scottsdale Smash!",
      body: "Your team, coach, location, day, and time are set. Season fee request to follow.",
    },
  });
  await prisma.messageRecipient.create({ data: { messageId: msg.id, personId: p1.id, inAppStatus: "DELIVERED", emailStatus: "SENT" } });
  await prisma.messageRecipient.create({ data: { messageId: msg.id, personId: p2.id, inAppStatus: "READ", emailStatus: "DELIVERED", readAt: new Date() } });

  console.log("\n✅ Seed complete.\n");
  console.log("Demo logins (password: '" + DEMO_PASSWORD + "'):");
  console.log("  COO      → coo@purepickleball.com");
  console.log("  CEO      → ceo@purepickleball.com");
  console.log("  Director → director@purepickleball.com");
  console.log("  Coach    → sam.coach@purepickleball.com");
  console.log("  Player   → emma.player@example.com");
  void director; void divYouthMS; void facPrivate;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
