import { NextResponse } from "next/server";
import { formatDate } from "@/lib/time";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { roundRobin, leagueWeekDates, LEAGUE_WEEKS } from "@/lib/domain/fixtures";
import { leagueStartDate, FIRST_LEAGUE_WEEK } from "@/lib/domain/seasonCalendar";
import { teamConfirmation, shouldEscalate } from "@/lib/domain/availability";
import { validateLineup, type LineupPair } from "@/lib/domain/lineup";
import { matchTypeConfig, isCountingLine } from "@/lib/domain/matchType";
import { scoringFromForm, scoringFormatOf, maxGames } from "@/lib/domain/scoringFormat";

// League mutations as a native-form-POST route handler with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. Handles all seven league ops.
export const dynamic = "force-dynamic";

// [id] ops redirect back to the fixture page; top-level ops to the league index.
const FIXTURE_OPS = new Set(["submitLineup", "submitLineups", "enterScores", "acceptScores", "disputeScores", "setScoringFormat", "recordForfeit", "submitToDupr"]);

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
      const matchType = String(formData.get("matchType") ?? "").trim();
      const courts = String(formData.get("courtAllocation") ?? "").trim();
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr}`) : null;
      await prisma.fixture.update({
        where: { id },
        data: {
          ...(scheduledAt && !isNaN(scheduledAt.getTime()) ? { scheduledAt } : {}),
          facilityId,
          homeTeamId,
          awayTeamId,
          ...(matchType ? { matchType } : {}),
          ...(courts ? { courtAllocation: courts } : {}),
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

    // Schedule a single match slot: lock in a date, time, and location now, with
    // teams optional — assign them here later by editing the row. Teams and the
    // match type default to TBD/standard so a location + time can be secured
    // before the pairing is known. Feeds the same fixtures/leaderboard.
    case "addMatch": {
      const seasonId = String(formData.get("seasonId") ?? "");
      if (!seasonId) return back("?err=noseason");
      const homeTeamId = String(formData.get("homeTeamId") ?? "").trim() || null;
      const awayTeamId = String(formData.get("awayTeamId") ?? "").trim() || null;
      if (homeTeamId && awayTeamId && homeTeamId === awayTeamId) return back("?err=matchsame");
      const dateStr = String(formData.get("scheduledAt") ?? "").trim();
      const timeStr = String(formData.get("scheduledTime") ?? "").trim() || "18:00";
      if (!dateStr) return back("?err=matchdate");
      const scheduledAt = new Date(`${dateStr}T${timeStr}`);
      if (isNaN(scheduledAt.getTime())) return back("?err=matchdate");
      const facilityId = String(formData.get("facilityId") ?? "").trim() || null;
      const matchType = String(formData.get("matchType") ?? "TEAM_3").trim() || "TEAM_3";
      const courts = String(formData.get("courtAllocation") ?? "").trim() || null;
      const fmt = scoringFromForm((k) => (formData.get(k) as string | null));

      const agg = await prisma.fixture.aggregate({ where: { seasonId }, _max: { weekNumber: true } });
      const weekNumber = (agg._max.weekNumber ?? 0) + 1;

      const fixture = await prisma.fixture.create({
        data: {
          seasonId, weekNumber, scheduledAt, facilityId, homeTeamId, awayTeamId, matchType, courtAllocation: courts, status: "SCHEDULED",
          serveType: fmt.serveType, pointsTo: fmt.pointsTo, winByTwo: fmt.winByTwo, freezeAt: fmt.freezeAt, gamesToWin: fmt.gamesToWin,
        },
      });
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixture.id, action: "fixture.add", summary: homeTeamId && awayTeamId ? "Scheduled a match" : "Reserved a match slot (teams TBD)" });
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

    // Add a team to the active league's roster (LeagueTeam). Any team can join —
    // it does NOT need to be published or fully set up; day/time/facility can be
    // arranged here or on the team afterward.
    case "addLeagueTeam": {
      const seasonId = String(formData.get("seasonId") ?? "");
      const teamId = String(formData.get("teamId") ?? "").trim();
      if (!seasonId) return back("?err=noseason");
      if (!teamId) return back("?err=noteam");
      const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
      if (!team) return back("?err=noteam");
      await prisma.leagueTeam.upsert({
        where: { seasonId_teamId: { seasonId, teamId } },
        create: { seasonId, teamId },
        update: {},
      });
      await audit({ actorId: actor.userId, entityType: "Season", entityId: seasonId, action: "league.addTeam", summary: `Added ${team.name} to the league` });
      revalidatePath("/console/league");
      return back("?ok=addLeagueTeam");
    }

    // Add every team not already in the league — the one-click "pull them all in".
    case "addAllLeagueTeams": {
      const seasonId = String(formData.get("seasonId") ?? "");
      if (!seasonId) return back("?err=noseason");
      const inLeague = (await prisma.leagueTeam.findMany({ where: { seasonId }, select: { teamId: true } })).map((r) => r.teamId);
      const teams = await prisma.team.findMany({
        where: inLeague.length ? { id: { notIn: inLeague } } : {},
        select: { id: true },
      });
      if (teams.length) {
        await prisma.leagueTeam.createMany({ data: teams.map((t) => ({ seasonId, teamId: t.id })), skipDuplicates: true });
      }
      await audit({ actorId: actor.userId, entityType: "Season", entityId: seasonId, action: "league.addAllTeams", summary: `Added ${teams.length} team(s) to the league` });
      revalidatePath("/console/league");
      return back(`?ok=addLeagueTeam&n=${teams.length}`);
    }

    // Remove a team from the league roster. Its fixtures stay for the record;
    // clear & regenerate to rebuild the round-robin without it.
    case "removeLeagueTeam": {
      const seasonId = String(formData.get("seasonId") ?? "");
      const teamId = String(formData.get("teamId") ?? "").trim();
      if (!seasonId) return back("?err=noseason");
      if (!teamId) return back("?err=noteam");
      await prisma.leagueTeam.deleteMany({ where: { seasonId, teamId } });
      await audit({ actorId: actor.userId, entityType: "Season", entityId: seasonId, action: "league.removeTeam", summary: `Removed a team from the league` });
      revalidatePath("/console/league");
      return back("?ok=removeLeagueTeam");
    }

    case "generateFixtures": {
      const seasonId = String(formData.get("seasonId") ?? "");
      const season = seasonId
        ? await prisma.season.findUnique({ where: { id: seasonId } })
        : await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
      if (!season) return back("?err=noseason");

      // Don't regenerate over existing fixtures — clear first.
      const existing = await prisma.fixture.count({ where: { seasonId: season.id } });
      if (existing > 0) return back("?err=hasfixtures");

      // The roster is the explicit league membership (LeagueTeam), not the
      // season's teams — a flat round-robin over whichever published teams the
      // admin added.
      const entries = await prisma.leagueTeam.findMany({
        where: { seasonId: season.id },
        include: { team: { select: { id: true, facilityId: true } } },
      });
      if (entries.length < 2) return back("?err=fewteams");

      const blackouts = (await prisma.blackoutDate.findMany({ where: { facilityId: null } })).map((b) => b.date);
      // League nights are dated from the week of Oct 26 (season week 7), not the
      // practice-season start, and numbered as season weeks 7–11 (§2.6).
      const dates = leagueWeekDates(leagueStartDate(), blackouts, LEAGUE_WEEKS);
      const hub = await prisma.facility.findFirst({ where: { acpLeagueOption: true } });
      const facilityOf = new Map(entries.map((e) => [e.team.id, e.team.facilityId]));

      const rounds = roundRobin(entries.map((e) => e.team.id)).slice(0, LEAGUE_WEEKS);
      let createdFixtures = 0;
      for (let r = 0; r < rounds.length; r++) {
        const when = dates[r] ?? dates[dates.length - 1];
        for (const pair of rounds[r]) {
          if (!pair.homeId || !pair.awayId) continue; // skip byes
          await prisma.fixture.create({
            data: {
              seasonId: season.id,
              weekNumber: r + FIRST_LEAGUE_WEEK,
              scheduledAt: when,
              facilityId: hub?.id ?? facilityOf.get(pair.homeId) ?? null,
              homeTeamId: pair.homeId,
              awayTeamId: pair.awayId,
              status: "SCHEDULED",
              courtAllocation: "Courts 1–4",
            },
          });
          createdFixtures++;
        }
      }

      await audit({
        actorId: actor.userId,
        entityType: "Season",
        entityId: season.id,
        action: "GENERATE_FIXTURES",
        summary: `Generated ${createdFixtures} fixtures across ${entries.length} team(s)`,
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

      const detail = `${fixture.homeTeam?.name} vs ${fixture.awayTeam?.name} on ${formatDate(fixture.scheduledAt)} at ${fixture.facility?.name ?? "the hub venue"} (${fixture.courtAllocation ?? "courts TBA"}). Please confirm availability in your portal.`;

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
        where: { role: { in: ["ADMIN", "DIRECTOR", "COO"] }, personId: { not: null } },
        select: { personId: true },
      });
      const body = `48-hour alert: ${atRisk.join("; ")} short of the minimum confirmed players for the fixture on ${formatDate(fixture.scheduledAt)}. Courts may need to be released.`;

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

    // Submit BOTH teams' line-ups from one combined form. Each team is validated
    // and rebuilt independently, and a team with no line inputs is left exactly
    // as it was — so saving one team's line-up never disturbs the other's.
    case "submitLineups": {
      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } });
      if (!fixture) return back("?err=nofixture");
      const teamIds = formData.getAll("teamId").map(String).filter(Boolean);

      const prepared: { teamId: string; pairs: LineupPair[] }[] = [];
      for (const teamId of teamIds) {
        const team = await prisma.team.findUnique({ where: { id: teamId } });
        if (!team) continue;

        const pairs: LineupPair[] = [];
        let partial = false;
        for (let line = 1; line <= 4; line++) {
          const a = String(formData.get(`lu_${teamId}_${line}_a`) ?? "");
          const b = String(formData.get(`lu_${teamId}_${line}_b`) ?? "");
          if (!a && !b) continue;
          if (!a || !b) { partial = true; continue; }
          if (a === b) return back("?err=selfpair");
          const [pa, pb] = await Promise.all([
            prisma.person.findUnique({ where: { id: a }, select: { duprRating: true } }),
            prisma.person.findUnique({ where: { id: b }, select: { duprRating: true } }),
          ]);
          pairs.push({ lineNumber: line, playerAId: a, playerBId: b, combinedDupr: (pa?.duprRating ?? 0) + (pb?.duprRating ?? 0) });
        }

        // No input for this team at all → leave its existing line-up untouched.
        if (pairs.length === 0 && !partial) continue;
        if (pairs.length < 3) return back("?err=minlines");
        const used = pairs.flatMap((p) => [p.playerAId, p.playerBId]);
        if (new Set(used).size !== used.length) return back("?err=dupplayer");
        const check = validateLineup(pairs, team.origin);
        if (!check.ok) return back(`?err=lineup&msg=${encodeURIComponent(check.error ?? "")}`);
        prepared.push({ teamId, pairs });
      }

      // Apply only the teams that were actually submitted.
      for (const { teamId, pairs } of prepared) {
        await prisma.pairing.deleteMany({ where: { teamId, weekNumber: fixture.weekNumber } });
        for (const p of pairs) {
          await prisma.pairing.create({
            data: { teamId, weekNumber: fixture.weekNumber, rank: p.lineNumber, playerAId: p.playerAId, playerBId: p.playerBId, combinedDupr: p.combinedDupr },
          });
        }
      }
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "LINEUP", summary: `Line-ups saved for ${prepared.length} team(s)` });
      revalidatePath(`/console/league/${fixtureId}`);
      return back("?ok=submitLineup");
    }

    // Enter line-by-line scores. Who is entering decides what happens:
    //   • "OFFICIAL" (admin authority) → scores are final: match COMPLETED,
    //     scoreStatus ACCEPTED, DUPR queued. Admins can enter or overwrite any
    //     time, which is how a dispute gets resolved.
    //   • a team id → the scores are a PROPOSAL awaiting the OTHER team's
    //     acceptance. The match stays SCHEDULED (out of the standings) until the
    //     opponent accepts. The opponent is notified to accept or dispute.
    case "enterScores": {
      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, include: { homeTeam: true, awayTeam: true } });
      if (!fixture) return back("?err=nofixture");
      const cfg = matchTypeConfig(fixture.matchType);
      const gameCount = maxGames(scoringFormatOf(fixture));
      const enteredBy = String(formData.get("enteredBy") ?? "OFFICIAL").trim();
      const proposal = enteredBy !== "OFFICIAL" && (enteredBy === fixture.homeTeamId || enteredBy === fixture.awayTeamId);

      // Rebuild all lines for this fixture, honouring the match format's line
      // count and which line (if any) is the non-counting exhibition.
      await prisma.lineMatchup.deleteMany({ where: { fixtureId } });

      for (let line = 1; line <= cfg.lines; line++) {
        const counting = isCountingLine(line, cfg);
        const games: { g: number; h: number; a: number }[] = [];
        for (let g = 1; g <= gameCount; g++) {
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
          data: { fixtureId, lineNumber: line, isCounting: counting, lineWinner },
        });
        for (const gm of games) {
          await prisma.gameScore.create({ data: { lineId: lm.id, gameNumber: gm.g, homeScore: gm.h, awayScore: gm.a } });
        }
      }

      if (proposal) {
        const proposingName = enteredBy === fixture.homeTeamId ? fixture.homeTeam?.name : fixture.awayTeam?.name;
        const opponentId = enteredBy === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
        await prisma.fixture.update({
          where: { id: fixtureId },
          data: { status: "SCHEDULED", scoreStatus: "PROPOSED", scoreProposedById: enteredBy, scoreProposedAt: new Date(), scoreAcceptedAt: null, scoreNote: null },
        });
        // Ask the opposing team to accept or dispute the entered scores.
        if (opponentId) {
          await dispatchMessage({
            senderId: actor.userId, seasonId: fixture.seasonId,
            audienceType: "TEAM", audienceRef: opponentId,
            channels: ["IN_APP", "EMAIL"], triggerType: "MATCH_NOTICE",
            subject: "Scores submitted — please review",
            body: `${proposingName ?? "The other team"} submitted scores for your match on ${formatDate(fixture.scheduledAt)}. Please review and accept, or flag a dispute.`,
          });
        }
        await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "SCORE_PROPOSED", summary: `Scores proposed by ${proposingName ?? "a team"} — awaiting acceptance` });
        revalidatePath(`/console/league/${fixtureId}`);
        revalidatePath("/console/league");
        return back("?ok=proposeScores");
      }

      // Official entry → final.
      await prisma.fixture.update({
        where: { id: fixtureId },
        data: { status: "COMPLETED", scoreStatus: "ACCEPTED", scoreProposedById: null, scoreAcceptedAt: new Date(), scoreNote: null },
      });

      // Queue DUPR submission (§12) — pending, unless already excluded by forfeit.
      await prisma.duprSubmission.upsert({
        where: { fixtureId },
        create: { fixtureId, status: "PENDING" },
        update: { status: "PENDING", lastError: null },
      });

      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "SCORE", summary: "Scores entered (official); match completed" });
      revalidatePath(`/console/league/${fixtureId}`);
      revalidatePath("/standings");
      revalidatePath("/console/league");
      return back("?ok=enterScores");
    }

    // The opposing team (or an admin on their behalf) accepts proposed scores.
    // The match becomes final and enters the standings; DUPR is queued.
    case "acceptScores": {
      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, include: { homeTeam: true, awayTeam: true } });
      if (!fixture) return back("?err=nofixture");
      if (fixture.scoreStatus !== "PROPOSED") return back("?err=noproposal");
      await prisma.fixture.update({
        where: { id: fixtureId },
        data: { status: "COMPLETED", scoreStatus: "ACCEPTED", scoreAcceptedAt: new Date(), scoreNote: null },
      });
      await prisma.duprSubmission.upsert({
        where: { fixtureId },
        create: { fixtureId, status: "PENDING" },
        update: { status: "PENDING", lastError: null },
      });
      // Confirm to both teams that the result is final.
      for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[]) {
        await dispatchMessage({
          senderId: actor.userId, seasonId: fixture.seasonId,
          audienceType: "TEAM", audienceRef: teamId,
          channels: ["IN_APP"], triggerType: "MATCH_NOTICE",
          subject: "Match result confirmed",
          body: `Both teams have agreed the scores for the match on ${formatDate(fixture.scheduledAt)}. The result is now final and on the leaderboard.`,
        });
      }
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "SCORE_ACCEPTED", summary: "Proposed scores accepted; match completed" });
      revalidatePath(`/console/league/${fixtureId}`);
      revalidatePath("/standings");
      revalidatePath("/console/league");
      return back("?ok=acceptScores");
    }

    // The opposing team flags the proposed scores as wrong. The match reopens
    // (out of the standings) with the dispute note; an admin resolves it by
    // entering official scores.
    case "disputeScores": {
      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, include: { homeTeam: true, awayTeam: true } });
      if (!fixture) return back("?err=nofixture");
      if (fixture.scoreStatus !== "PROPOSED") return back("?err=noproposal");
      const note = String(formData.get("scoreNote") ?? "").trim() || null;
      await prisma.fixture.update({
        where: { id: fixtureId },
        data: { status: "SCHEDULED", scoreStatus: "DISPUTED", scoreNote: note },
      });
      // Notify the proposing team + admins that the scores are contested.
      if (fixture.scoreProposedById) {
        await dispatchMessage({
          senderId: actor.userId, seasonId: fixture.seasonId,
          audienceType: "TEAM", audienceRef: fixture.scoreProposedById,
          channels: ["IN_APP", "EMAIL"], triggerType: "MATCH_NOTICE",
          subject: "Scores disputed",
          body: `The submitted scores for the match on ${formatDate(fixture.scheduledAt)} were disputed${note ? `: “${note}”` : ""}. An admin will confirm the official result.`,
        });
      }
      const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "DIRECTOR", "COO"] }, personId: { not: null } }, select: { personId: true } });
      for (const a of admins) {
        if (a.personId) await dispatchMessage({ senderId: actor.userId, seasonId: fixture.seasonId, audienceType: "SINGLE_PERSON", audienceRef: a.personId, channels: ["IN_APP"], triggerType: "MATCH_NOTICE", subject: "Score dispute to resolve", body: `A score dispute needs an official result for the match on ${formatDate(fixture.scheduledAt)}.` });
      }
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "SCORE_DISPUTED", summary: `Proposed scores disputed${note ? `: ${note}` : ""}` });
      revalidatePath(`/console/league/${fixtureId}`);
      revalidatePath("/console/league");
      return back("?ok=disputeScores");
    }

    // Set the scoring format for a fixture (serve type, points-to, win-by-2,
    // rally freeze, games-to-win) from the match page.
    case "setScoringFormat": {
      const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, select: { id: true } });
      if (!fixture) return back("?err=nofixture");
      const fmt = scoringFromForm((k) => (formData.get(k) as string | null));
      await prisma.fixture.update({
        where: { id: fixtureId },
        data: { serveType: fmt.serveType, pointsTo: fmt.pointsTo, winByTwo: fmt.winByTwo, freezeAt: fmt.freezeAt, gamesToWin: fmt.gamesToWin },
      });
      await audit({ actorId: actor.userId, entityType: "Fixture", entityId: fixtureId, action: "fixture.scoringFormat", summary: "Updated scoring format" });
      revalidatePath(`/console/league/${fixtureId}`);
      return back("?ok=setScoringFormat");
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
          body: `The fixture on ${formatDate(fixture.scheduledAt)} was recorded as a forfeit (3–0). ${team.forfeitCount >= 2 ? "This is the team's second forfeit — Championship eligibility is now ended pending joint exception." : ""}`,
        });
      }
      const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "DIRECTOR", "COO"] }, personId: { not: null } }, select: { personId: true } });
      for (const a of admins) {
        if (a.personId) await dispatchMessage({ senderId: actor.userId, seasonId: fixture.seasonId, audienceType: "SINGLE_PERSON", audienceRef: a.personId, channels: ["IN_APP", "EMAIL"], triggerType: "FORFEIT_RECORDED", subject: "Forfeit recorded", body: `${team.forfeitCount === 1 ? "First" : "Second"} forfeit recorded for a team in the fixture on ${formatDate(fixture.scheduledAt)}.` });
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
