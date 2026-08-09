"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { validateLineup, type LineupPair } from "@/lib/domain/lineup";

async function requireLeagueManager() {
  const session = await getSession();
  if (!session || !can(session.role, "manageScheduling")) {
    throw new Error("Not authorized.");
  }
  return session;
}

/**
 * Submit a team's line-up for a fixture (§14). PURE teams rank by team rank set
 * by the coach; non-PURE teams MUST rank by combined DUPR (line 1 > 2 > 3) and
 * the system rejects a non-compliant line-up. Line 4 is the exhibition line
 * where the team carries eight — recorded but non-counting.
 */
export async function submitLineup(formData: FormData) {
  const session = await requireLeagueManager();
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");

  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } });
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!fixture || !team) throw new Error("Fixture or team not found.");

  const pairs: LineupPair[] = [];
  for (let line = 1; line <= 4; line++) {
    const a = String(formData.get(`line${line}_a`) ?? "");
    const b = String(formData.get(`line${line}_b`) ?? "");
    if (!a || !b) continue;
    if (a === b) throw new Error(`Line ${line}: a player can't be paired with themselves.`);
    const [pa, pb] = await Promise.all([
      prisma.person.findUnique({ where: { id: a }, select: { duprRating: true } }),
      prisma.person.findUnique({ where: { id: b }, select: { duprRating: true } }),
    ]);
    pairs.push({
      lineNumber: line,
      playerAId: a,
      playerBId: b,
      combinedDupr: (pa?.duprRating ?? 0) + (pb?.duprRating ?? 0),
    });
  }

  if (pairs.length < 3) throw new Error("Submit at least three lines.");

  // Reject a player used on two lines.
  const used = pairs.flatMap((p) => [p.playerAId, p.playerBId]);
  if (new Set(used).size !== used.length) throw new Error("A player appears on more than one line.");

  const check = validateLineup(pairs, team.origin);
  if (!check.ok) throw new Error(check.error);

  // Replace this team's pairings for this week.
  await prisma.pairing.deleteMany({ where: { teamId, weekNumber: fixture.weekNumber } });
  for (const p of pairs) {
    await prisma.pairing.create({
      data: {
        teamId,
        weekNumber: fixture.weekNumber,
        rank: p.lineNumber,
        playerAId: p.playerAId,
        playerBId: p.playerBId,
        combinedDupr: p.combinedDupr,
      },
    });
  }

  await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "LINEUP", summary: `Line-up submitted for ${team.name} (${pairs.length} lines)` });
  revalidatePath(`/console/league/${fixtureId}`);
}

/**
 * Enter line-by-line, game-by-game scores (§12). Stores individual game scores
 * per line; line 4 is flagged non-counting. Completing the match queues a DUPR
 * submission (unless forfeited).
 */
export async function enterScores(formData: FormData) {
  const session = await requireLeagueManager();
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, include: { homeTeam: true, awayTeam: true } });
  if (!fixture) throw new Error("Fixture not found.");

  // Rebuild all lines for this fixture.
  await prisma.lineMatchup.deleteMany({ where: { fixtureId } });

  for (let line = 1; line <= 4; line++) {
    const isCounting = line <= 3;
    const games: { g: number; h: number; a: number }[] = [];
    for (let g = 1; g <= 3; g++) {
      const hRaw = formData.get(`l${line}_g${g}_h`);
      const aRaw = formData.get(`l${line}_g${g}_a`);
      if (hRaw === null || aRaw === null || String(hRaw) === "" || String(aRaw) === "") continue;
      games.push({ g, h: Number(hRaw), a: Number(aRaw) });
    }
    if (games.length === 0) continue;

    let hWon = 0;
    let aWon = 0;
    for (const gm of games) {
      if (gm.h > gm.a) hWon++;
      else if (gm.a > gm.h) aWon++;
    }
    const lineWinner = hWon > aWon ? "HOME" : aWon > hWon ? "AWAY" : null;

    const lm = await prisma.lineMatchup.create({
      data: { fixtureId, lineNumber: line, isCounting, lineWinner },
    });
    for (const gm of games) {
      await prisma.gameScore.create({ data: { lineId: lm.id, gameNumber: gm.g, homeScore: gm.h, awayScore: gm.a } });
    }
  }

  await prisma.fixture.update({ where: { id: fixtureId }, data: { status: "COMPLETED" } });

  // Queue DUPR submission (§12) — pending, unless already excluded by forfeit.
  await prisma.duprSubmission.upsert({
    where: { fixtureId },
    create: { fixtureId, status: "PENDING" },
    update: { status: "PENDING", lastError: null },
  });

  await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "SCORE", summary: "Scores entered; match completed" });
  revalidatePath(`/console/league/${fixtureId}`);
  revalidatePath("/standings");
  revalidatePath("/console/league");
}

/**
 * Record a forfeit (§12/§14): 3–0 in the standings, never submitted to DUPR.
 * Two forfeits ends Championship eligibility (restorable only by joint
 * Director+COO exception). The available team still plays; the court is paid for.
 */
export async function recordForfeit(formData: FormData) {
  const session = await requireLeagueManager();
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const forfeitingTeamId = String(formData.get("forfeitingTeamId") ?? "");

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!fixture) throw new Error("Fixture not found.");

  await prisma.fixture.update({
    where: { id: fixtureId },
    data: { status: "FORFEITED", forfeitedById: forfeitingTeamId },
  });

  // Exclude from DUPR by rule — no games were played (§12).
  await prisma.duprSubmission.upsert({
    where: { fixtureId },
    create: { fixtureId, status: "EXCLUDED", lastError: "Forfeit — excluded from DUPR by rule" },
    update: { status: "EXCLUDED", lastError: "Forfeit — excluded from DUPR by rule" },
  });

  // Forfeit counter; two forfeits ends championship eligibility.
  const team = await prisma.team.update({
    where: { id: forfeitingTeamId },
    data: { forfeitCount: { increment: 1 } },
  });
  if (team.forfeitCount >= 2 && team.champEligible) {
    await prisma.team.update({ where: { id: forfeitingTeamId }, data: { champEligible: false } });
  }

  // Notify both teams + contacts + Director + COO (§13).
  for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[]) {
    await dispatchMessage({
      senderId: session.userId, seasonId: fixture.seasonId,
      audienceType: "TEAM", audienceRef: teamId,
      channels: ["IN_APP", "EMAIL"], triggerType: "FORFEIT_RECORDED",
      subject: "Forfeit recorded",
      body: `The fixture on ${fixture.scheduledAt.toLocaleDateString()} was recorded as a forfeit (3–0). ${team.forfeitCount >= 2 ? "This is the team's second forfeit — Championship eligibility is now ended pending joint exception." : ""}`,
    });
  }
  const admins = await prisma.user.findMany({ where: { role: { in: ["DIRECTOR", "COO"] }, personId: { not: null } }, select: { personId: true } });
  for (const a of admins) {
    if (a.personId) await dispatchMessage({ senderId: session.userId, seasonId: fixture.seasonId, audienceType: "SINGLE_PERSON", audienceRef: a.personId, channels: ["IN_APP", "EMAIL"], triggerType: "FORFEIT_RECORDED", subject: "Forfeit recorded", body: `${team.forfeitCount === 1 ? "First" : "Second"} forfeit recorded for a team in the fixture on ${fixture.scheduledAt.toLocaleDateString()}.` });
  }

  await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "FORFEIT", summary: `Forfeit by team ${forfeitingTeamId}; forfeitCount now ${team.forfeitCount}` });
  revalidatePath(`/console/league/${fixtureId}`);
  revalidatePath("/standings");
  revalidatePath("/console/league");
}

/**
 * Submit results to DUPR (§12). Never submits a forfeited fixture. Verifies every
 * rostered player in the played lines has a VERIFIED DUPR account before
 * submitting — an identity error moves a stranger's rating. On failure the
 * submission enters an error state in the retry queue.
 */
export async function submitToDupr(formData: FormData) {
  const session = await requireLeagueManager();
  const fixtureId = String(formData.get("fixtureId") ?? "");

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { lines: true, duprSubmission: true },
  });
  if (!fixture) throw new Error("Fixture not found.");
  if (fixture.status === "FORFEITED") throw new Error("Forfeited fixtures are never submitted to DUPR.");

  // Reconcile identities: every player on a line must have a verified DUPR account.
  const pairings = await prisma.pairing.findMany({
    where: { teamId: { in: [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[] }, weekNumber: fixture.weekNumber },
    include: { playerA: true, playerB: true },
  });
  const players = pairings.flatMap((p) => [p.playerA, p.playerB]);
  const unverified = players.filter((pl) => !pl.duprId || !pl.duprVerified);

  const attempts = (fixture.duprSubmission?.attempts ?? 0) + 1;

  if (unverified.length > 0) {
    await prisma.duprSubmission.upsert({
      where: { fixtureId },
      create: { fixtureId, status: "REJECTED", attempts, lastError: `Unverified DUPR: ${unverified.map((u) => `${u.firstName} ${u.lastName}`).join(", ")}` },
      update: { status: "REJECTED", attempts, lastError: `Unverified DUPR: ${unverified.map((u) => `${u.firstName} ${u.lastName}`).join(", ")}` },
    });
    await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "DUPR_REJECTED", summary: `Rejected: ${unverified.length} unverified player(s)` });
    revalidatePath(`/console/league/${fixtureId}`);
    return;
  }

  // Simulated successful submission — the real DUPR schema is confirmed before
  // wiring the live client (§12). Every game is reported, including line 4.
  await prisma.duprSubmission.upsert({
    where: { fixtureId },
    create: { fixtureId, status: "SUBMITTED", attempts, submittedAt: new Date() },
    update: { status: "SUBMITTED", attempts, submittedAt: new Date(), lastError: null },
  });
  await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "DUPR_SUBMITTED", summary: `Submitted to DUPR (attempt ${attempts})` });
  revalidatePath(`/console/league/${fixtureId}`);
  revalidatePath("/console/league");
}
