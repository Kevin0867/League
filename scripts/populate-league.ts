/**
 * Populate the active ACP league with existing published teams and a set of
 * completed test matches, so the leaderboard is exercised end to end.
 *
 * Scoring model (matches the app):
 *   - Every line is a SINGLE game to 11, win by 2.
 *   - A match has 4 lines. Lines 1–3 COUNT; line 4 is an exhibition — it is
 *     played and scored, but excluded from the match result, the leaderboard,
 *     and point differential.
 *   - Match winner = the team that takes 2 or 3 of the counting lines.
 *
 * Idempotent: it clears this season's league membership + fixtures first, then
 * rebuilds a round-robin and scores every match. Re-running gives a clean set.
 *
 * Run locally:  npx tsx --tsconfig tsconfig.scripts.json scripts/populate-league.ts
 * Run on Neon:  the populate-league GitHub Actions workflow.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// How many published teams to enroll (a full round-robin over this many).
const MAX_TEAMS = 8;

// Deterministic PRNG so re-runs are stable.
let _s = 20260811;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/** A single game to 11, win by 2, from the winner's perspective. */
function game(): { w: number; l: number } {
  const loser = int(2, 10);
  if (loser <= 9) return { w: 11, l: loser };
  // Deuce: winner must clear by two (12–10, 13–11, 14–12).
  const extra = int(0, 2);
  return { w: 11 + 1 + extra, l: 10 + extra };
}

/** Circle-method round robin: one array of [home, away] pairs per round. */
function roundRobin(ids: string[]): Array<Array<[string, string]>> {
  const arr = [...ids];
  if (arr.length % 2 === 1) arr.push("BYE");
  const n = arr.length;
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "BYE" && b !== "BYE") {
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

async function main() {
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  if (!season) {
    console.error("No active ACP league/season found. Create one in the console first.");
    process.exit(1);
  }
  console.log(`League: ${season.name} (${season.id})`);

  // Prefer published teams; if there aren't enough, top up with the fullest
  // rosters so there's a real leaderboard to look at.
  const published = await prisma.team.findMany({
    where: { published: true },
    include: { _count: { select: { members: true } } },
    orderBy: { name: "asc" },
  });
  let chosen = published;
  if (chosen.length < 2) {
    console.log(`Only ${chosen.length} published team(s); topping up with the fullest rosters.`);
    const more = await prisma.team.findMany({
      where: { id: { notIn: chosen.map((t) => t.id) } },
      include: { _count: { select: { members: true } } },
      orderBy: { members: { _count: "desc" } },
      take: MAX_TEAMS,
    });
    chosen = [...chosen, ...more];
  }
  chosen = chosen.slice(0, MAX_TEAMS);
  if (chosen.length < 2) {
    console.error("Need at least two teams to build a league. None available.");
    process.exit(1);
  }
  console.log(`Enrolling ${chosen.length} teams: ${chosen.map((t) => t.name).join(", ")}`);

  // Clean slate for this season's league.
  const existingFx = await prisma.fixture.findMany({ where: { seasonId: season.id }, select: { id: true } });
  const fxIds = existingFx.map((f) => f.id);
  if (fxIds.length) {
    const lines = await prisma.lineMatchup.findMany({ where: { fixtureId: { in: fxIds } }, select: { id: true } });
    const lineIds = lines.map((l) => l.id);
    if (lineIds.length) await prisma.gameScore.deleteMany({ where: { lineId: { in: lineIds } } });
    await prisma.lineMatchup.deleteMany({ where: { fixtureId: { in: fxIds } } });
    await prisma.availabilityConfirmation.deleteMany({ where: { fixtureId: { in: fxIds } } });
    await prisma.duprSubmission.deleteMany({ where: { fixtureId: { in: fxIds } } });
    await prisma.rescheduleRequest.deleteMany({ where: { fixtureId: { in: fxIds } } });
    await prisma.fixture.deleteMany({ where: { id: { in: fxIds } } });
  }
  await prisma.leagueTeam.deleteMany({ where: { seasonId: season.id } });
  console.log(`Cleared ${fxIds.length} existing fixture(s) and prior league membership.`);

  // Enroll teams.
  for (const t of chosen) {
    await prisma.leagueTeam.create({ data: { seasonId: season.id, teamId: t.id } });
  }

  // Give each team a strength so the leaderboard shows a real spread.
  const strength = new Map(chosen.map((t, i) => [t.id, int(4, 12) + (chosen.length - i)]));

  const rounds = roundRobin(chosen.map((t) => t.id));
  let matchCount = 0;
  let lineCount = 0;

  for (let r = 0; r < rounds.length; r++) {
    const when = new Date(season.startDate.getTime() + r * 7 * 864e5);
    for (const [homeId, awayId] of rounds[r]) {
      const fixture = await prisma.fixture.create({
        data: {
          seasonId: season.id,
          weekNumber: r + 1,
          scheduledAt: when,
          homeTeamId: homeId,
          awayTeamId: awayId,
          status: "COMPLETED",
          courtAllocation: "Courts 1–4",
        },
      });

      const sH = strength.get(homeId)!;
      const sA = strength.get(awayId)!;
      const pHome = sH / (sH + sA);

      for (let line = 1; line <= 4; line++) {
        const isCounting = line <= 3;
        const homeWins = rnd() < pHome;
        const g = game();
        const homeScore = homeWins ? g.w : g.l;
        const awayScore = homeWins ? g.l : g.w;
        const lm = await prisma.lineMatchup.create({
          data: {
            fixtureId: fixture.id,
            lineNumber: line,
            isCounting,
            lineWinner: homeWins ? "HOME" : "AWAY",
          },
        });
        await prisma.gameScore.create({
          data: { lineId: lm.id, gameNumber: 1, homeScore, awayScore },
        });
        lineCount++;
      }
      matchCount++;
    }
  }

  console.log(`Created ${matchCount} completed matches, ${lineCount} lines (1 game to 11, win by 2).`);
  console.log("Line 4 on every match is an exhibition — scored, but excluded from the leaderboard.");
  console.log("Done. The console and public leaderboards now reflect these results.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
