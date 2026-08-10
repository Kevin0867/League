import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { buildFirstRound, advanceTarget } from "@/lib/domain/bracket";
import { computeStandings, type FixtureResult } from "@/lib/domain/standings";

// Championship mutations as native-form-POST route handlers with ticket auth.
// Route handlers 303-redirect to a fresh GET (which carries the session
// cookie), so unlike a server action they don't re-render inline under the
// cookieless POST and bounce through the console layout's auth. See
// /api/console/facilities.
export const dynamic = "force-dynamic";

// Championship week starts Monday Dec 7, 2026; division events run Mon–Fri.
function roundDate(round: number): Date {
  const d = new Date(Date.UTC(2026, 11, 7, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + (round - 1));
  return d;
}

/** Seed a division's champ-eligible teams by standings order. */
async function seedTeams(seasonId: string, divisionId: string): Promise<string[]> {
  const teams = await prisma.team.findMany({ where: { seasonId, divisionId } });
  const teamIds = teams.map((t) => t.id);

  const fixtures = await prisma.fixture.findMany({
    where: { seasonId, OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] },
    include: { lines: { include: { games: true } } },
  });
  const fixtureResults: FixtureResult[] = fixtures.map((f) => ({
    homeTeamId: f.homeTeamId,
    awayTeamId: f.awayTeamId,
    status: f.status,
    forfeitedById: f.forfeitedById,
    lines: f.lines.map((l) => ({
      lineNumber: l.lineNumber,
      isCounting: l.isCounting,
      games: l.games.map((g) => ({ homeScore: g.homeScore, awayScore: g.awayScore, isCounting: l.isCounting })),
    })),
  }));
  const standings = computeStandings(fixtureResults);
  const rank = new Map(standings.map((s, i) => [s.teamId, i]));

  // Eligible teams ordered by standings; teams with no games fall to the end.
  return teams
    .filter((t) => t.champEligible)
    .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
    .map((t) => t.id);
}

/** Place an advancing winner into its next-round slot. */
async function placeWinner(seasonId: string, divisionId: string, round: number, slot: number, winnerTeamId: string, seed: number | null) {
  const { nextSlot, asHome } = advanceTarget(slot);
  const next = await prisma.championshipMatch.findUnique({
    where: { seasonId_divisionId_round_slot: { seasonId, divisionId, round: round + 1, slot: nextSlot } },
  });
  if (!next) return; // was the final
  const data = asHome
    ? { homeTeamId: winnerTeamId, homeSeed: seed }
    : { awayTeamId: winnerTeamId, awaySeed: seed };
  const updated = await prisma.championshipMatch.update({ where: { id: next.id }, data });
  // If both sides are now set, the match is ready to play.
  if (updated.homeTeamId && updated.awayTeamId && updated.status === "PENDING") {
    await prisma.championshipMatch.update({ where: { id: next.id }, data: { status: "READY" } });
  }
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/championship${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  // Both operations preserve the original requireManager() gate: manageScheduling.
  if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

  const op = String(formData.get("op") ?? "");

  if (op === "generateBracket") return generateBracket(formData, actor, back);
  if (op === "recordResult") return recordChampResult(formData, actor, back);
  if (op === "setStart") {
    const seasonId = String(formData.get("seasonId") ?? "");
    if (!seasonId) return back("?err=division");
    const dateStr = String(formData.get("date") ?? "").trim();
    const timeStr = String(formData.get("time") ?? "").trim() || "09:00";
    const startsAt = dateStr ? new Date(`${dateStr}T${timeStr}`) : null;
    await prisma.season.update({
      where: { id: seasonId },
      data: { championshipStartsAt: startsAt && !isNaN(startsAt.getTime()) ? startsAt : null },
    });
    await audit({ actorId: actor.userId, entityType: "Season", entityId: seasonId, action: "championship.setStart", summary: startsAt ? `Championship start ${startsAt.toISOString()}` : "Cleared championship start" });
    return back("?ok=start");
  }

  return back("?err=op");
}

/** Draw (or redraw) a division's single-elimination bracket from standings. */
async function generateBracket(
  formData: FormData,
  actor: { userId: string; role: string },
  back: (qs: string) => NextResponse
) {
  const divisionId = String(formData.get("divisionId") ?? "");
  const division = await prisma.division.findUnique({ where: { id: divisionId } });
  if (!division) return back("?err=division");
  const seasonId = division.seasonId;

  const seeded = await seedTeams(seasonId, divisionId);
  if (seeded.length < 2) return back("?err=eligible");

  // Fresh draw.
  await prisma.championshipMatch.deleteMany({ where: { seasonId, divisionId } });

  const { size, rounds, matches } = buildFirstRound(seeded);

  // Create all rounds up front; later rounds start empty.
  for (let r = 1; r <= rounds; r++) {
    const slots = size / 2 ** r;
    for (let s = 0; s < slots; s++) {
      await prisma.championshipMatch.create({
        data: { seasonId, divisionId, round: r, slot: s, status: "PENDING", scheduledAt: roundDate(r) },
      });
    }
  }

  // Fill round 1 with seeded teams.
  for (const m of matches) {
    const bothPresent = m.homeTeamId && m.awayTeamId;
    await prisma.championshipMatch.update({
      where: { seasonId_divisionId_round_slot: { seasonId, divisionId, round: 1, slot: m.slot } },
      data: {
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeSeed: m.homeSeed,
        awaySeed: m.awaySeed,
        status: bothPresent ? "READY" : (m.homeTeamId || m.awayTeamId) ? "BYE" : "PENDING",
        winnerTeamId: bothPresent ? null : (m.homeTeamId ?? m.awayTeamId ?? null),
      },
    });
    // Auto-advance byes.
    if (!bothPresent && (m.homeTeamId || m.awayTeamId)) {
      const winner = (m.homeTeamId ?? m.awayTeamId)!;
      const seed = m.homeTeamId ? m.homeSeed : m.awaySeed;
      await placeWinner(seasonId, divisionId, 1, m.slot, winner, seed);
    }
  }

  await audit({ actorId: actor.userId, entityType: "ChampionshipMatch", entityId: divisionId, action: "GENERATE_BRACKET", summary: `Drew a ${size}-team bracket (${rounds} rounds) from ${seeded.length} seeds` });
  return back("?ok=bracket");
}

/** Record a championship match result and advance the winner. */
async function recordChampResult(
  formData: FormData,
  actor: { userId: string; role: string },
  back: (qs: string) => NextResponse
) {
  const matchId = String(formData.get("matchId") ?? "");
  const winnerTeamId = String(formData.get("winnerTeamId") ?? "");
  const homeScore = formData.get("homeScore") !== null && String(formData.get("homeScore")) !== "" ? Number(formData.get("homeScore")) : null;
  const awayScore = formData.get("awayScore") !== null && String(formData.get("awayScore")) !== "" ? Number(formData.get("awayScore")) : null;

  const match = await prisma.championshipMatch.findUnique({ where: { id: matchId } });
  if (!match) return back("?err=match");
  if (!match.homeTeamId || !match.awayTeamId) return back("?err=teams");
  if (winnerTeamId !== match.homeTeamId && winnerTeamId !== match.awayTeamId) {
    return back("?err=winner");
  }

  await prisma.championshipMatch.update({
    where: { id: matchId },
    data: { winnerTeamId, homeScore, awayScore, status: "COMPLETED" },
  });

  const seed = winnerTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
  await placeWinner(match.seasonId, match.divisionId, match.round, match.slot, winnerTeamId, seed ?? null);

  await audit({ actorId: actor.userId, entityType: "ChampionshipMatch", entityId: matchId, action: "RESULT", summary: `Winner ${winnerTeamId}` });
  return back("?ok=result");
}
