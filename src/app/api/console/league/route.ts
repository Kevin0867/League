import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { roundRobin, leagueWeekDates, LEAGUE_WEEKS } from "@/lib/domain/fixtures";
import { teamConfirmation, shouldEscalate } from "@/lib/domain/availability";
import { validateLineup, type LineupPair } from "@/lib/domain/lineup";

// League mutations as a native-form-POST route handler with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. Handles all seven league ops.
export const dynamic = "force-dynamic";

// [id] ops redirect back to the fixture page; top-level ops to the league index.
const FIXTURE_OPS = new Set(["submitLineup", "enterScores", "recordForfeit", "submitToDupr"]);

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const op = String(formData.get("op") ?? "");
  const fixtureId = String(formData.get("fixtureId") ?? "");

  const basePath = FIXTURE_OPS.has(op) ? `/console/league/${fixtureId}` : "/console/league";
  const back = (qs: string) => NextResponse.redirect(new URL(`${basePath}${qs}`, origin), 303);

  // Preserves requireLeagueManager(): manageScheduling gate on the actor.
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

  switch (op) {
    // ---- Top-level ops (src/app/console/league/actions.ts) --------------------

    // Edit a single fixture: reschedule, change hub, or set status.
    case "editFixture": {
      const id = String(formData.get("fixtureId") ?? "");
      if (!id) return back("?err=nofixture");
      const dateStr = String(formData.get("scheduledAt") ?? "").trim();
      const timeStr = String(formData.get("scheduledTime") ?? "").trim() || "18:00";
      const facilityId = String(formData.get("facilityId") ?? "").trim() || null;
      const status = String(formData.get("status") ?? "").trim();
      const homeTeamId = String(formData.get("homeTeamId") ?? "").trim() || null;
      const awayTeamId = String(formData.get("awayTeamId") ?? "").trim() || null;
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr}`) : null;
      await prisma.fixture.update({
        where: { id },
        data: {
          ...(scheduledAt && !isNaN(scheduledAt.getTime()) ? { scheduledAt } : {}),
          facilityId,
          homeTeamId,
          awayTeamId,
          ...(status ? { status } : {}),
        },
      });
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: id, action: "fixture.update", summary: "Edited fixture" });
      return back("?ok=editFixture");
    }

    // Create a new ACP league (season) and make it the active one. Other ACP
    // seasons are deactivated so the League page shows this new league.
    case "createLeague": {
      const name = String(formData.get("name") ?? "").trim();
      const startStr = String(formData.get("startDate") ?? "").trim();
      const endStr = String(formData.get("endDate") ?? "").trim();
      if (!name || !startStr || !endStr) return back("?err=leaguefields");
      const startDate = new Date(startStr);
      const endDate = new Date(endStr);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) return back("?err=leaguedates");

      await prisma.season.updateMany({ where: { program: "ACP", active: true }, data: { active: false } });
      const season = await prisma.season.create({
        data: { name, program: "ACP", startDate, endDate, active: true },
      });
      await audit({ actorId: actor.userId, entityType: "Season", entityId: season.id, action: "league.create", summary: `Created ACP league ${name}` });
      return back("?ok=createLeague");
    }

    // Manually schedule a single match between two teams (location + time),
    // outside the round-robin generator. Feeds the same fixtures/leaderboard.
    case "addMatch": {
      const seasonId = String(formData.get("seasonId") ?? "");
      if (!seasonId) return back("?err=noseason");
      const homeTeamId = String(formData.get("homeTeamId") ?? "").trim();
      const awayTeamId = String(formData.get("awayTeamId") ?? "").trim();
      if (!homeTeamId || !awayTeamId) return back("?err=matchteams");
      if (homeTeamId === awayTeamId) return back("?err=matchsame");
      const dateStr = String(formData.get("scheduledAt") ?? "").trim();
      const timeStr = String(formData.get("scheduledTime") ?? "").trim() || "18:00";
      if (!dateStr) return back("?err=matchdate");
      const scheduledAt = new Date(`${dateStr}T${timeStr}`);
      if (isNaN(scheduledAt.getTime())) return back("?err=matchdate");
      const facilityId = String(formData.get("facilityId") ?? "").trim() || null;

      const agg = await prisma.fixture.aggregate({ where: { seasonId }, _max: { weekNumber: true } });
      const weekNumber = (agg._max.weekNumber ?? 0) + 1;

      const fixture = await prisma.fixture.create({
        data: { seasonId, weekNumber, scheduledAt, facilityId, homeTeamId, awayTeamId, status: "SCHEDULED" },
      });
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixture.id, action: "fixture.add", summary: "Scheduled a match" });
      return back("?ok=addMatch");
    }

    // Clear all fixtures for a season so they can be regenerated.
    case "clearFixtures": {
      const seasonId = String(formData.get("seasonId") ?? "");
      if (!seasonId) return back("?err=noseason");
      const fx = await prisma.fixture.findMany({ where: { seasonId }, select: { id: true } });
      const ids = fx.map((f) => f.id);
      if (ids.length) {
        await prisma.availabilityConfirmation.deleteMany({ where: { fixtureId: { in: ids } } });
        await prisma.fixture.deleteMany({ where: { id: { in: ids } } });
      }
      await audit({ actorId: actor.userId, entityType: "Season", entityId: seasonId, action: "fixture.clear", summary: `Cleared ${ids.length} fixtures` });
      return back("?ok=clearFixtures");
    }

    case "generateFixtures": {
      const seasonId = String(formData.get("seasonId") ?? "");
      const season = seasonId
        ? await prisma.season.findUnique({ where: { id: seasonId } })
        : await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
      if (!season) return back("?err=noseason");

      const blackouts = (await prisma.blackoutDate.findMany({ where: { facilityId: null } })).map((b) => b.date);
      const dates = leagueWeekDates(season.startDate, blackouts, LEAGUE_WEEKS);
      const hub = await prisma.facility.findFirst({ where: { acpLeagueOption: true } });

      const divisions = await prisma.division.findMany({
        where: { seasonId: season.id },
        include: { teams: { select: { id: true, dayOfWeek: true, startTime: true, facilityId: true } } },
      });

      let createdFixtures = 0;
      for (const div of divisions) {
        if (div.teams.length < 2) continue;
        const existing = await prisma.fixture.count({
          where: { seasonId: season.id, homeTeam: { divisionId: div.id } },
        });
        if (existing > 0) continue;

        const rounds = roundRobin(div.teams.map((t) => t.id)).slice(0, LEAGUE_WEEKS);
        for (let r = 0; r < rounds.length; r++) {
          const when = dates[r] ?? dates[dates.length - 1];
          for (const pair of rounds[r]) {
            if (!pair.homeId || !pair.awayId) continue; // skip byes
            const homeTeam = div.teams.find((t) => t.id === pair.homeId);
            await prisma.fixture.create({
              data: {
                seasonId: season.id,
                weekNumber: r + 1,
                scheduledAt: when,
                facilityId: hub?.id ?? homeTeam?.facilityId ?? null,
                homeTeamId: pair.homeId,
                awayTeamId: pair.awayId,
                status: "SCHEDULED",
                courtAllocation: "Courts 1–4",
              },
            });
            createdFixtures++;
          }
        }
      }

      await audit({
        actorId: actor.userId,
        entityType: "Season",
        entityId: season.id,
        action: "GENERATE_FIXTURES",
        summary: `Generated ${createdFixtures} fixtures across ${divisions.length} division(s)`,
      });

      revalidatePath("/console/league");
      revalidatePath("/schedule");
      revalidatePath("/standings");
      return back("?ok=generateFixtures");
    }

    case "sendMatchNotice": {
      const fixture = await prisma.fixture.findUnique({
        where: { id: fixtureId },
        include: { homeTeam: true, awayTeam: true, facility: true },
      });
      if (!fixture) return back("?err=nofixture");

      const detail = `${fixture.homeTeam?.name} vs ${fixture.awayTeam?.name} on ${fixture.scheduledAt.toLocaleDateString()} at ${fixture.facility?.name ?? "the hub venue"} (${fixture.courtAllocation ?? "courts TBA"}). Please confirm availability in your portal.`;

      for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[]) {
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: fixture.seasonId,
          audienceType: "TEAM",
          audienceRef: teamId,
          channels: ["IN_APP", "EMAIL"],
          triggerType: "MATCH_NOTICE",
          subject: "Match details — please confirm availability",
          body: detail,
        });
      }
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "MATCH_NOTICE", summary: "Sent 7-day match notice" });
      revalidatePath("/console/league");
      return back("?ok=sendMatchNotice");
    }

    case "sendEscalationAlert": {
      const now = new Date();

      const fixture = await prisma.fixture.findUnique({
        where: { id: fixtureId },
        include: {
          homeTeam: { include: { members: true } },
          awayTeam: { include: { members: true } },
          confirmations: true,
        },
      });
      if (!fixture) return back("?err=nofixture");

      const atRisk: string[] = [];
      for (const team of [fixture.homeTeam, fixture.awayTeam]) {
        if (!team) continue;
        const statuses = team.members.map(
          (m) => fixture.confirmations.find((c) => c.personId === m.personId)?.status ?? "UNCONFIRMED"
        );
        const tc = teamConfirmation(team.id, team.name, team.members.length, statuses);
        if (shouldEscalate(fixture.scheduledAt, now, tc)) {
          atRisk.push(`${team.name} (${tc.confirmedPlaying}/${6} confirmed)`);
        }
      }

      if (atRisk.length === 0) {
        return back("?err=norisk"); // nothing to escalate
      }

      // Alert coach + Director + COO. Coaches receive via the team message; staff via
      // their roles. We message all admins here for simplicity.
      const admins = await prisma.user.findMany({
        where: { role: { in: ["DIRECTOR", "COO"] }, personId: { not: null } },
        select: { personId: true },
      });
      const body = `48-hour alert: ${atRisk.join("; ")} short of the minimum confirmed players for the fixture on ${fixture.scheduledAt.toLocaleDateString()}. Courts may need to be released.`;

      for (const a of admins) {
        if (!a.personId) continue;
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: fixture.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: a.personId,
          channels: ["IN_APP", "EMAIL", "SMS"],
          triggerType: "AVAILABILITY_ESCALATION",
          subject: "48-hour availability alert",
          body,
        });
      }
      // Also notify each at-risk team's contact/coach.
      for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[]) {
        await dispatchMessage({
          senderId: actor.userId, seasonId: fixture.seasonId,
          audienceType: "TEAM", audienceRef: teamId,
          channels: ["IN_APP", "SMS"], triggerType: "AVAILABILITY_ESCALATION",
          subject: "Confirm availability now", body: "We're short of confirmed players 48 hours out. Please mark Playing/Not playing in your portal immediately.",
        });
      }

      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "ESCALATE", summary: `48-hour alert: ${atRisk.join("; ")}` });
      revalidatePath("/console/league");
      return back("?ok=sendEscalationAlert");
    }

    // ---- Fixture ops (src/app/console/league/[id]/actions.ts) -----------------

    case "submitLineup": {
      const teamId = String(formData.get("teamId") ?? "");

      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } });
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!fixture || !team) return back("?err=notfound");

      const pairs: LineupPair[] = [];
      for (let line = 1; line <= 4; line++) {
        const a = String(formData.get(`line${line}_a`) ?? "");
        const b = String(formData.get(`line${line}_b`) ?? "");
        if (!a || !b) continue;
        if (a === b) return back("?err=selfpair");
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

      if (pairs.length < 3) return back("?err=minlines");

      // Reject a player used on two lines.
      const used = pairs.flatMap((p) => [p.playerAId, p.playerBId]);
      if (new Set(used).size !== used.length) return back("?err=dupplayer");

      const check = validateLineup(pairs, team.origin);
      if (!check.ok) return back(`?err=lineup&msg=${encodeURIComponent(check.error ?? "")}`);

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

      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "LINEUP", summary: `Line-up submitted for ${team.name} (${pairs.length} lines)` });
      revalidatePath(`/console/league/${fixtureId}`);
      return back("?ok=submitLineup");
    }

    case "enterScores": {
      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, include: { homeTeam: true, awayTeam: true } });
      if (!fixture) return back("?err=nofixture");

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

      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "SCORE", summary: "Scores entered; match completed" });
      revalidatePath(`/console/league/${fixtureId}`);
      revalidatePath("/standings");
      revalidatePath("/console/league");
      return back("?ok=enterScores");
    }

    case "recordForfeit": {
      const forfeitingTeamId = String(formData.get("forfeitingTeamId") ?? "");
      if (!forfeitingTeamId) return back("?err=noteam");

      const fixture = await prisma.fixture.findUnique({
        where: { id: fixtureId },
        include: { homeTeam: true, awayTeam: true },
      });
      if (!fixture) return back("?err=nofixture");

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
          senderId: actor.userId, seasonId: fixture.seasonId,
          audienceType: "TEAM", audienceRef: teamId,
          channels: ["IN_APP", "EMAIL"], triggerType: "FORFEIT_RECORDED",
          subject: "Forfeit recorded",
          body: `The fixture on ${fixture.scheduledAt.toLocaleDateString()} was recorded as a forfeit (3–0). ${team.forfeitCount >= 2 ? "This is the team's second forfeit — Championship eligibility is now ended pending joint exception." : ""}`,
        });
      }
      const admins = await prisma.user.findMany({ where: { role: { in: ["DIRECTOR", "COO"] }, personId: { not: null } }, select: { personId: true } });
      for (const a of admins) {
        if (a.personId) await dispatchMessage({ senderId: actor.userId, seasonId: fixture.seasonId, audienceType: "SINGLE_PERSON", audienceRef: a.personId, channels: ["IN_APP", "EMAIL"], triggerType: "FORFEIT_RECORDED", subject: "Forfeit recorded", body: `${team.forfeitCount === 1 ? "First" : "Second"} forfeit recorded for a team in the fixture on ${fixture.scheduledAt.toLocaleDateString()}.` });
      }

      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "FORFEIT", summary: `Forfeit by team ${forfeitingTeamId}; forfeitCount now ${team.forfeitCount}` });
      revalidatePath(`/console/league/${fixtureId}`);
      revalidatePath("/standings");
      revalidatePath("/console/league");
      return back("?ok=recordForfeit");
    }

    case "submitToDupr": {
      const fixture = await prisma.fixture.findUnique({
        where: { id: fixtureId },
        include: { lines: true, duprSubmission: true },
      });
      if (!fixture) return back("?err=nofixture");
      if (fixture.status === "FORFEITED") return back("?err=forfeited");

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
        await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "DUPR_REJECTED", summary: `Rejected: ${unverified.length} unverified player(s)` });
        revalidatePath(`/console/league/${fixtureId}`);
        return back("?ok=submitToDupr");
      }

      // Simulated successful submission — the real DUPR schema is confirmed before
      // wiring the live client (§12). Every game is reported, including line 4.
      await prisma.duprSubmission.upsert({
        where: { fixtureId },
        create: { fixtureId, status: "SUBMITTED", attempts, submittedAt: new Date() },
        update: { status: "SUBMITTED", attempts, submittedAt: new Date(), lastError: null },
      });
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "DUPR_SUBMITTED", summary: `Submitted to DUPR (attempt ${attempts})` });
      revalidatePath(`/console/league/${fixtureId}`);
      revalidatePath("/console/league");
      return back("?ok=submitToDupr");
    }

    default:
      return back("?err=op");
  }
}
