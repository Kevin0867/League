import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { buildFirstRound, advanceTarget } from "@/lib/domain/bracket";
import {
  buildDoubleElim, computeLiveness, winnersWinnerTarget, winnersLoserTarget,
  losersWinnerTarget, losersAdvanceSlot,
} from "@/lib/domain/bracketDouble";
import {
  buildWaterfall, computeLiveness as wfLiveness, goldWinnerTarget, goldLoserTarget, flightWinnerTarget,
} from "@/lib/domain/bracketWaterfall";
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

/** Place an advancing winner into its next-round slot (single-elimination / W bracket). */
async function placeWinner(seasonId: string, divisionId: string, round: number, slot: number, winnerTeamId: string, seed: number | null) {
  const { nextSlot, asHome } = advanceTarget(slot);
  const next = await prisma.championshipMatch.findUnique({
    where: { seasonId_divisionId_bracket_round_slot: { seasonId, divisionId, bracket: "W", round: round + 1, slot: nextSlot } },
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

// ---- Double-elimination helpers -------------------------------------------

/** A double-elim draw exists for this division iff it has any L or GF matches. */
async function isDoubleElim(seasonId: string, divisionId: string): Promise<boolean> {
  const n = await prisma.championshipMatch.count({ where: { seasonId, divisionId, bracket: { in: ["L", "GF"] } } });
  return n > 0;
}

/** Bracket size (power of two) and real-team count, derived from the W round-1 matches. */
async function deSizeAndN(seasonId: string, divisionId: string): Promise<{ size: number; n: number }> {
  const first = await prisma.championshipMatch.findMany({ where: { seasonId, divisionId, bracket: "W", round: 1 } });
  const size = Math.max(2, first.length * 2);
  let n = 0;
  for (const m of first) { if (m.homeTeamId) n++; if (m.awayTeamId) n++; }
  return { size, n };
}

/** Put a team into a target slot. Missing/dead targets are ignored. Accepts any
 *  bracket string so both the double-elim and waterfall engines can use it. */
async function placeInto(
  seasonId: string, divisionId: string,
  t: { bracket: string; round: number; slot: number; asHome: boolean },
  teamId: string, seed: number | null,
) {
  const target = await prisma.championshipMatch.findUnique({
    where: { seasonId_divisionId_bracket_round_slot: { seasonId, divisionId, bracket: t.bracket, round: t.round, slot: t.slot } },
  });
  if (!target) return;
  await prisma.championshipMatch.update({
    where: { id: target.id },
    data: t.asHome ? { homeTeamId: teamId, homeSeed: seed } : { awayTeamId: teamId, awaySeed: seed },
  });
}

/** Route a completed match's winner (and, for a W match, its loser) onward. */
async function advanceDouble(
  seasonId: string, divisionId: string, size: number,
  match: { bracket: string; round: number; slot: number; homeTeamId: string | null; awayTeamId: string | null; homeSeed: number | null; awaySeed: number | null },
  winnerTeamId: string, loserTeamId: string | null,
) {
  const winnerSeed = winnerTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
  const loserSeed = loserTeamId && loserTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
  if (match.bracket === "W") {
    await placeInto(seasonId, divisionId, winnersWinnerTarget(size, match.round, match.slot), winnerTeamId, winnerSeed);
    if (loserTeamId) await placeInto(seasonId, divisionId, winnersLoserTarget(size, match.round, match.slot), loserTeamId, loserSeed);
  } else if (match.bracket === "L") {
    const adv = losersWinnerTarget(size, match.round);
    if (adv.toGF) await placeInto(seasonId, divisionId, { bracket: "GF", round: 1, slot: 0, asHome: false }, winnerTeamId, winnerSeed);
    else await placeInto(seasonId, divisionId, losersAdvanceSlot(size, match.round, match.slot), winnerTeamId, winnerSeed);
    // The Losers-bracket loser is eliminated (second loss).
  }
  // GF winner is the champion — nothing to advance.
}

/**
 * Settle byes and mark playable matches, cascading walkovers. A match whose
 * missing side is structurally dead (its feeder was a bye) auto-advances the
 * present team; a match with both teams present becomes READY.
 */
async function resolveDouble(seasonId: string, divisionId: string, size: number, n: number) {
  const live = computeLiveness(size, n);
  for (let guard = 0; guard < 200; guard++) {
    const matches = await prisma.championshipMatch.findMany({ where: { seasonId, divisionId } });
    let changed = false;
    for (const m of matches) {
      if (m.status === "COMPLETED" || m.status === "BYE") continue;
      const lv = live.get(`${m.bracket}-${m.round}-${m.slot}`) ?? { home: true, away: true };
      const hasHome = !!m.homeTeamId, hasAway = !!m.awayTeamId;
      if (hasHome && hasAway) {
        if (m.status === "PENDING") { await prisma.championshipMatch.update({ where: { id: m.id }, data: { status: "READY" } }); changed = true; }
        continue;
      }
      // Walkover only when the empty side can never be filled (dead feeder).
      let winner: string | null = null;
      if (hasHome && !lv.away) winner = m.homeTeamId;
      else if (hasAway && !lv.home) winner = m.awayTeamId;
      if (!winner) continue;
      await prisma.championshipMatch.update({ where: { id: m.id }, data: { status: "BYE", winnerTeamId: winner } });
      await advanceDouble(seasonId, divisionId, size, m, winner, null);
      changed = true;
    }
    if (!changed) break;
  }
}

// ---- Waterfall helpers -----------------------------------------------------

/** A waterfall draw exists iff this division has GOLD-bracket matches. */
async function isWaterfall(seasonId: string, divisionId: string): Promise<boolean> {
  const n = await prisma.championshipMatch.count({ where: { seasonId, divisionId, bracket: "GOLD" } });
  return n > 0;
}

async function wfSizeAndN(seasonId: string, divisionId: string): Promise<{ size: number; n: number }> {
  const first = await prisma.championshipMatch.findMany({ where: { seasonId, divisionId, bracket: "GOLD", round: 1 } });
  const size = Math.max(2, first.length * 2);
  let n = 0;
  for (const m of first) { if (m.homeTeamId) n++; if (m.awayTeamId) n++; }
  return { size, n };
}

/** Route a completed waterfall match: Gold winners advance in Gold and drop
 *  their loser into the matching flight; flight winners advance in their flight. */
async function advanceWaterfall(
  seasonId: string, divisionId: string, size: number,
  match: { bracket: string; round: number; slot: number; homeTeamId: string | null; awayTeamId: string | null; homeSeed: number | null; awaySeed: number | null },
  winnerTeamId: string, loserTeamId: string | null,
) {
  const winnerSeed = winnerTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
  const loserSeed = loserTeamId && loserTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
  if (match.bracket === "GOLD") {
    const wt = goldWinnerTarget(size, match.round, match.slot);
    if (wt) await placeInto(seasonId, divisionId, wt, winnerTeamId, winnerSeed);
    if (loserTeamId) {
      const lt = goldLoserTarget(size, match.round, match.slot);
      if (lt) await placeInto(seasonId, divisionId, lt, loserTeamId, loserSeed);
    }
  } else {
    const fr = parseInt(match.bracket.slice(1), 10);
    const wt = flightWinnerTarget(size, fr, match.round, match.slot);
    if (wt) await placeInto(seasonId, divisionId, wt, winnerTeamId, winnerSeed);
    // Flight loser is eliminated.
  }
}

async function resolveWaterfall(seasonId: string, divisionId: string, size: number, n: number) {
  const live = wfLiveness(size, n);
  for (let guard = 0; guard < 200; guard++) {
    const matches = await prisma.championshipMatch.findMany({ where: { seasonId, divisionId } });
    let changed = false;
    for (const m of matches) {
      if (m.status === "COMPLETED" || m.status === "BYE") continue;
      const lv = live.get(`${m.bracket}-${m.round}-${m.slot}`) ?? { home: true, away: true };
      const hasHome = !!m.homeTeamId, hasAway = !!m.awayTeamId;
      if (hasHome && hasAway) {
        if (m.status === "PENDING") { await prisma.championshipMatch.update({ where: { id: m.id }, data: { status: "READY" } }); changed = true; }
        continue;
      }
      let winner: string | null = null;
      if (hasHome && !lv.away) winner = m.homeTeamId;
      else if (hasAway && !lv.home) winner = m.awayTeamId;
      if (!winner) continue;
      await prisma.championshipMatch.update({ where: { id: m.id }, data: { status: "BYE", winnerTeamId: winner } });
      await advanceWaterfall(seasonId, divisionId, size, m, winner, null);
      changed = true;
    }
    if (!changed) break;
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

  const formatRaw = String(formData.get("format") ?? "single").trim();
  const format = formatRaw === "double" || formatRaw === "waterfall" ? formatRaw : "single";

  // Fresh draw.
  await prisma.championshipMatch.deleteMany({ where: { seasonId, divisionId } });

  if (format === "waterfall") {
    const { size, matches } = buildWaterfall(seeded);
    const n = seeded.length;
    const live = wfLiveness(size, n);
    for (const m of matches) {
      const lv = live.get(`${m.bracket}-${m.round}-${m.slot}`);
      if (lv && !lv.home && !lv.away) continue;
      await prisma.championshipMatch.create({
        data: {
          seasonId, divisionId, bracket: m.bracket, round: m.round, slot: m.slot,
          homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, homeSeed: m.homeSeed, awaySeed: m.awaySeed,
          status: "PENDING", scheduledAt: roundDate(m.round),
        },
      });
    }
    await resolveWaterfall(seasonId, divisionId, size, n);
    await audit({ actorId: actor.userId, entityType: "ChampionshipMatch", entityId: divisionId, action: "GENERATE_BRACKET", summary: `Drew a ${size}-team waterfall bracket from ${seeded.length} seeds` });
    return back("?ok=bracket");
  }

  if (format === "double") {
    const { size, matches } = buildDoubleElim(seeded);
    const n = seeded.length;
    const live = computeLiveness(size, n);
    // Create only reachable matches (skip fully-dead placeholders from byes).
    for (const m of matches) {
      const lv = live.get(`${m.bracket}-${m.round}-${m.slot}`);
      if (lv && !lv.home && !lv.away) continue;
      await prisma.championshipMatch.create({
        data: {
          seasonId, divisionId, bracket: m.bracket, round: m.round, slot: m.slot,
          homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, homeSeed: m.homeSeed, awaySeed: m.awaySeed,
          status: "PENDING", scheduledAt: roundDate(m.round),
        },
      });
    }
    // Settle byes and mark playable matches.
    await resolveDouble(seasonId, divisionId, size, n);
    await audit({ actorId: actor.userId, entityType: "ChampionshipMatch", entityId: divisionId, action: "GENERATE_BRACKET", summary: `Drew a ${size}-team double-elimination bracket from ${seeded.length} seeds` });
    return back("?ok=bracket");
  }

  const { size, rounds, matches } = buildFirstRound(seeded);

  // Create all rounds up front; later rounds start empty.
  for (let r = 1; r <= rounds; r++) {
    const slots = size / 2 ** r;
    for (let s = 0; s < slots; s++) {
      await prisma.championshipMatch.create({
        data: { seasonId, divisionId, bracket: "W", round: r, slot: s, status: "PENDING", scheduledAt: roundDate(r) },
      });
    }
  }

  // Fill round 1 with seeded teams.
  for (const m of matches) {
    const bothPresent = m.homeTeamId && m.awayTeamId;
    await prisma.championshipMatch.update({
      where: { seasonId_divisionId_bracket_round_slot: { seasonId, divisionId, bracket: "W", round: 1, slot: m.slot } },
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

  const loserTeamId = winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
  if (await isWaterfall(match.seasonId, match.divisionId)) {
    // Waterfall: advance the winner; a Gold loser drops into its flight.
    const { size, n } = await wfSizeAndN(match.seasonId, match.divisionId);
    await advanceWaterfall(match.seasonId, match.divisionId, size, match, winnerTeamId, match.bracket === "GOLD" ? loserTeamId : null);
    await resolveWaterfall(match.seasonId, match.divisionId, size, n);
  } else if (await isDoubleElim(match.seasonId, match.divisionId)) {
    // Double-elimination: route the winner onward and drop a Winners loser into
    // the Losers bracket, then settle any resulting walkovers.
    const { size, n } = await deSizeAndN(match.seasonId, match.divisionId);
    await advanceDouble(match.seasonId, match.divisionId, size, match, winnerTeamId, match.bracket === "W" ? loserTeamId : null);
    await resolveDouble(match.seasonId, match.divisionId, size, n);
  } else {
    const seed = winnerTeamId === match.homeTeamId ? match.homeSeed : match.awaySeed;
    await placeWinner(match.seasonId, match.divisionId, match.round, match.slot, winnerTeamId, seed ?? null);
  }

  await audit({ actorId: actor.userId, entityType: "ChampionshipMatch", entityId: matchId, action: "RESULT", summary: `Winner ${winnerTeamId}` });
  return back("?ok=result");
}
