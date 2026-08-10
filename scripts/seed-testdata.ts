/**
 * Test-environment seeder. Clean-slate: wipes operational data (registrations,
 * teams, coaches, facilities, payments, messages, sessions, fixtures) while
 * PRESERVING seasons, divisions, rate config, and staff logins (COO/CEO/
 * DIRECTOR) — so you can still sign in — then loads a rich test dataset:
 *   - 10 facilities across markets, mixed agreement status + fee basis
 *   - 20 coaches with varied clearance and availability
 *   - 250 players with NO email/phone, registered to the active PURE season
 *   - Teams at every stage: building, ready, and published
 *
 * Run locally:  npx tsx --tsconfig tsconfig.scripts.json scripts/seed-testdata.ts
 * Run on Neon:  the seed-testdata GitHub Actions workflow.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const STAFF_ROLES = ["COO", "CEO", "DIRECTOR"];
const TAG = "TESTSEED";

// Deterministic PRNG so re-runs are stable (no Math.random in this environment).
let _s = 1234567;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const FIRST = ["Aiden","Ava","Liam","Mia","Noah","Emma","Ethan","Olivia","Mason","Sophia","Lucas","Isabella","Logan","Amelia","Jack","Harper","Leo","Evelyn","Owen","Abigail","Ben","Ella","Sam","Grace","Henry","Chloe","Jack","Lily","Wyatt","Zoe","Caleb","Nora","Dylan","Hazel","Nathan","Aria","Isaac","Layla","Ryan","Riley","Adam","Nadia","Marcus","Priya","Diego","Sofia","Omar","Yara","Kevin","Brett","Jim","Sara","Paul","Dana","Rick","Tina","Carl","Beth","Neil","Gwen"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts"];
const MARKETS = ["Scottsdale","Phoenix","Gilbert","Mesa","Chandler","Tempe"];
const DAYS = ["MON","TUE","WED","THU","FRI","SAT","SUN"];

const name = () => ({ firstName: pick(FIRST), lastName: pick(LAST) });
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5);
const daysAhead = (d: number) => new Date(Date.now() + d * 864e5);

async function wipe() {
  console.log("Wiping operational data (preserving seasons, divisions, rate config, staff logins)…");
  await prisma.auditLog.deleteMany({});
  await prisma.gameScore.deleteMany({});
  await prisma.lineMatchup.deleteMany({});
  await prisma.availabilityConfirmation.deleteMany({});
  await prisma.rescheduleRequest.deleteMany({});
  await prisma.duprSubmission.deleteMany({});
  await prisma.fixture.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.sessionTeam.deleteMany({});
  await prisma.sessionCoach.deleteMany({});
  await prisma.coachPayoutLine.deleteMany({});
  await prisma.payoutRun.deleteMany({});
  await prisma.facilityStatement.deleteMany({});
  await prisma.alaCarteBooking.deleteMany({});
  await prisma.alaCarteOffering.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.messageRecipient.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.courtBlock.deleteMany({});
  await prisma.blackoutDate.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.championshipMatch.deleteMany({});
  await prisma.pairing.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.availabilityBlock.deleteMany({});
  await prisma.coach.deleteMany({});
  await prisma.facility.deleteMany({});
  await prisma.locationPreference.deleteMany({});
  await prisma.waiver.deleteMany({});
  await prisma.registration.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  await prisma.user.deleteMany({ where: { role: { notIn: STAFF_ROLES } } });

  const staff = await prisma.user.findMany({ where: { role: { in: STAFF_ROLES }, personId: { not: null } }, select: { personId: true } });
  const keepIds = staff.map((s) => s.personId!) as string[];
  await prisma.person.updateMany({ data: { guardianId: null } });
  await prisma.person.deleteMany({ where: { id: { notIn: keepIds.length ? keepIds : ["_none_"] } } });
  console.log(`  kept ${keepIds.length} staff person(s).`);
}

async function seedFacilities() {
  const specs: Array<[string, string, number, string, string, boolean]> = [
    // name, market, courts, agreementStatus, feeBasis, isPrivate
    ["Scottsdale Ranch Pickleball Complex", "Scottsdale", 8, "EXECUTED", "PER_COURT", false],
    ["Gilbert Regional Courts", "Gilbert", 6, "EXECUTED", "PER_SESSION", false],
    ["Mesa Riverview Courts", "Mesa", 10, "EXECUTED", "NONE", false],
    ["Tempe Sports Complex", "Tempe", 6, "EXECUTED", "PER_HOUR", false],
    ["Chandler Community Center", "Chandler", 4, "EXECUTED", "PERCENTAGE", false],
    ["Phoenix Central Racquet Club", "Phoenix", 12, "AGREEMENT_SENT", "PER_COURT", false],
    ["North Scottsdale Private Courts", "Scottsdale", 2, "VERBAL", "NONE", true],
    ["Ahwatukee Pickleball Park", "Phoenix", 5, "IDENTIFIED", "PER_SESSION", false],
    ["Val Vista Lakes Club", "Gilbert", 3, "VERBAL", "PER_HOUR", true],
    ["Mesa Downtown Athletic", "Mesa", 8, "AGREEMENT_SENT", "PER_COURT", false],
  ];
  const facs = [];
  for (const [fname, market, courts, status, feeBasis, isPrivate] of specs) {
    const f = await prisma.facility.create({
      data: {
        name: fname, market, courtCount: courts, agreementStatus: status, feeBasis,
        weekdayRateCents: feeBasis === "NONE" || feeBasis === "PERCENTAGE" ? 0 : int(80, 200) * 100,
        weekendRateCents: feeBasis === "NONE" || feeBasis === "PERCENTAGE" ? 0 : int(100, 250) * 100,
        percentageRate: feeBasis === "PERCENTAGE" ? 0.15 : null,
        primaryContact: `${pick(FIRST)} ${pick(LAST)}`,
        contactEmail: `${TAG.toLowerCase()}@seed.local`,
        contactPhone: null,
        isPrivate,
        generalArea: isPrivate ? `${market} area` : null,
        exactAddress: `${int(100, 9999)} N ${pick(LAST)} Rd, ${market}, AZ`,
        alaCarteAllowed: chance(0.5),
        acpLeagueOption: chance(0.4),
      },
    });
    facs.push(f);
  }
  console.log(`  ${facs.length} facilities (5 executed).`);
  return facs;
}

async function seedCoaches() {
  const LEVELS = ["2.5–3.5", "3.0–4.0", "3.5–4.5", "4.0–5.0", "Youth, Elementary–Middle", "Youth, High School", "All levels"];
  const coaches = [];
  for (let i = 0; i < 20; i++) {
    const { firstName, lastName } = name();
    const cleared = i < 13; // 13 cleared, 7 not
    const hasAvail = i % 3 !== 0; // ~13-14 with availability, rest incomplete
    const person = await prisma.person.create({ data: { firstName, lastName, howHeard: TAG } });
    await prisma.user.create({
      data: { email: `coach${i + 1}@seed.local`, passwordHash: await bcrypt.hash("pickleball", 10), role: "COACH", personId: person.id, active: true },
    });
    const markets = hasAvail ? Array.from(new Set([pick(MARKETS), pick(MARKETS)])) : [];
    const coach = await prisma.coach.create({
      data: {
        personId: person.id,
        rpoCertLevel: chance(0.6) ? pick(["IPTPA I", "IPTPA II", "PPR", "PCI"]) : null,
        certifications: cleared ? "USA Pickleball background check on file" : null,
        bio: `${firstName} has coached ${int(1, 12)} seasons.`,
        coachingLevels: pick(LEVELS),
        backgroundCheckDate: cleared ? daysAgo(int(30, 300)) : null,
        backgroundCheckExpiry: cleared ? daysAhead(int(60, 400)) : null,
        onboardingCompletedAt: cleared ? daysAgo(int(10, 200)) : null,
        marketsCovered: markets.length ? JSON.stringify(markets) : null,
        isProCoach: chance(0.3),
        w9OnFile: chance(0.6),
      },
    });
    if (hasAvail) {
      const nblocks = int(1, 3);
      const used = new Set<string>();
      for (let b = 0; b < nblocks; b++) {
        const day = pick(DAYS);
        if (used.has(day)) continue;
        used.add(day);
        const start = pick(["09:00", "16:00", "17:00", "18:00"]);
        await prisma.availabilityBlock.create({ data: { coachId: coach.id, dayOfWeek: day, startTime: start, endTime: `${String(Number(start.slice(0, 2)) + 2).padStart(2, "0")}:00` } });
      }
    }
    coaches.push({ coach, cleared, markets });
  }
  console.log(`  20 coaches (13 cleared, ~13 with availability).`);
  return coaches;
}

async function seedPlayers(seasonId: string, divisions: { id: string; name: string; divisionType: string; minRating: number | null; maxRating: number | null }[]) {
  const schoolDivs = divisions.filter((d) => d.divisionType === "SCHOOL_LEVEL");
  const bandDivs = divisions.filter((d) => d.divisionType === "DUPR_BAND");
  const people: { id: string; adult: boolean; rating: number | null; divisionId: string | null }[] = [];
  for (let i = 0; i < 250; i++) {
    const adult = chance(0.55);
    const rating = adult ? [2.5, 3.0, 3.5, 4.0, 4.5, 5.0][int(0, 5)] : null;
    const dob = adult ? daysAgo(int(19, 60) * 365) : daysAgo(int(8, 17) * 365);
    const div = adult
      ? bandDivs.find((d) => rating! >= (d.minRating ?? 0) && rating! <= (d.maxRating ?? 9)) ?? pick(bandDivs)
      : pick(schoolDivs);
    const { firstName, lastName } = name();
    const person = await prisma.person.create({
      data: {
        firstName, lastName, dob, email: null, phone: null, howHeard: TAG,
        isMinor: !adult,
        duprRating: rating,
        duprVerified: adult && chance(0.4),
        waiverSignedAt: chance(0.6) ? daysAgo(int(1, 40)) : null,
      },
    });
    await prisma.registration.create({
      data: {
        personId: person.id, seasonId, divisionId: div?.id ?? null,
        skillLevel: rating ? String(rating) : "youth",
        programInterest: adult ? "Adult" : "Youth",
        duprRatingAtReg: rating,
        status: "SUBMITTED",
        submittedAt: daysAgo(int(1, 45)),
      },
    });
    people.push({ id: person.id, adult, rating, divisionId: div?.id ?? null });
  }
  console.log(`  250 players (no email/phone) registered to the active season.`);
  return people;
}

async function seedTeams(
  seasonId: string,
  divisions: { id: string; name: string }[],
  facilities: { id: string; name: string; market: string | null; agreementStatus: string }[],
  coaches: { coach: { id: string }; cleared: boolean; markets: string[] }[],
  players: { id: string; adult: boolean; rating: number | null; divisionId: string | null }[],
) {
  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED");
  const clearedCoaches = coaches.filter((c) => c.cleared);
  const pool = [...players];
  const takePlayers = (n: number, divisionId: string | null) => {
    const out: string[] = [];
    for (let i = 0; i < n && pool.length; i++) {
      const idx = pool.findIndex((p) => !divisionId || p.divisionId === divisionId);
      const chosen = idx >= 0 ? pool.splice(idx, 1)[0] : pool.pop()!;
      out.push(chosen.id);
    }
    return out;
  };

  let ci = 0, fi = 0;
  const mkTeam = async (label: string, stage: "building" | "ready" | "published", divisionId: string, market: string) => {
    const fac = stage === "building" && chance(0.5) ? null : executed[fi++ % executed.length];
    const coach = stage === "building" && chance(0.5) ? null : clearedCoaches[ci++ % clearedCoaches.length];
    const day = pick(DAYS);
    const complete = stage !== "building";
    const team = await prisma.team.create({
      data: {
        name: label, seasonId, divisionId, market,
        levelBand: complete ? label.split("·")[1]?.trim() ?? "Open" : (chance(0.5) ? "Open" : null),
        coachId: coach?.coach.id ?? null,
        facilityId: fac?.id ?? null,
        dayOfWeek: complete ? day : (chance(0.5) ? day : null),
        startTime: complete ? pick(["16:00", "17:00", "18:00"]) : (chance(0.5) ? "17:00" : null),
        origin: "PURE_ACADEMY",
        clubName: TAG, // hidden tag on PURE teams (not displayed)
        published: stage === "published",
        publishedAt: stage === "published" ? daysAgo(int(1, 20)) : null,
      },
    });
    // Roster: ready/published get 6–8, building get 0–4.
    const count = stage === "building" ? int(0, 4) : int(6, 8);
    const ids = takePlayers(count, divisionId);
    for (const pid of ids) {
      await prisma.teamMember.create({ data: { teamId: team.id, personId: pid, roleOnTeam: "PLAYER" } });
      await prisma.registration.updateMany({ where: { personId: pid, seasonId, status: "SUBMITTED" }, data: { status: "ASSIGNED" } });
    }
    return team;
  };

  const divPick = () => pick(divisions);
  let made = 0;
  // 6 building, 6 ready, 6 published
  for (const [stage, n] of [["building", 6], ["ready", 6], ["published", 6]] as const) {
    for (let i = 0; i < n; i++) {
      const d = divPick();
      const market = pick(MARKETS);
      const short = d.name.replace(/—/g, "").replace(/\s+/g, " ").trim();
      await mkTeam(`${market} ${short.split(" ").slice(-2).join(" ")} · ${short}`, stage, d.id, market);
      made++;
    }
  }
  console.log(`  ${made} teams (6 building, 6 ready, 6 published).`);
}

async function main() {
  await wipe();
  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" } });
  if (!season) throw new Error("No active PURE_ACADEMY season — cannot seed. Create/activate one first.");
  const divisions = await prisma.division.findMany({ where: { seasonId: season.id } });
  if (divisions.length === 0) throw new Error("Active season has no divisions.");
  console.log(`Seeding into ${season.name}…`);

  const facilities = await seedFacilities();
  const coaches = await seedCoaches();
  const players = await seedPlayers(season.id, divisions);
  await seedTeams(season.id, divisions, facilities, coaches, players);

  const counts = {
    facilities: await prisma.facility.count(),
    coaches: await prisma.coach.count(),
    players: await prisma.registration.count(),
    teams: await prisma.team.count(),
    assigned: await prisma.registration.count({ where: { status: "ASSIGNED" } }),
    published: await prisma.team.count({ where: { published: true } }),
  };
  console.log("Done:", counts);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
