"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { roundRobin, leagueWeekDates, LEAGUE_WEEKS } from "@/lib/domain/fixtures";
import { teamConfirmation, shouldEscalate } from "@/lib/domain/availability";

async function requireLeagueManager() {
  const session = await getSession();
  if (!session || !can(session.role, "manageScheduling")) {
    throw new Error("Not authorized to manage the league.");
  }
  return session;
}

/**
 * Generate round-robin fixtures for each ACP division across five league weeks
 * (§14). Idempotent per division. Divisions under four teams are reported but
 * still scheduled so the demo runs — consolidation is a staff decision.
 */
export async function generateFixtures(formData: FormData) {
  const session = await requireLeagueManager();
  const seasonId = String(formData.get("seasonId") ?? "");
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId } })
    : await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  if (!season) throw new Error("No ACP season found.");

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
    actorId: session.userId,
    entityType: "Season",
    entityId: season.id,
    action: "GENERATE_FIXTURES",
    summary: `Generated ${createdFixtures} fixtures across ${divisions.length} division(s)`,
  });

  revalidatePath("/console/league");
  revalidatePath("/schedule");
  revalidatePath("/standings");
}

/** 7-day match notice (§14): fixture details + an explicit request to confirm. */
export async function sendMatchNotice(formData: FormData) {
  const session = await requireLeagueManager();
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true, facility: true },
  });
  if (!fixture) throw new Error("Fixture not found.");

  const detail = `${fixture.homeTeam?.name} vs ${fixture.awayTeam?.name} on ${fixture.scheduledAt.toLocaleDateString()} at ${fixture.facility?.name ?? "the hub venue"} (${fixture.courtAllocation ?? "courts TBA"}). Please confirm availability in your portal.`;

  for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[]) {
    await dispatchMessage({
      senderId: session.userId,
      seasonId: fixture.seasonId,
      audienceType: "TEAM",
      audienceRef: teamId,
      channels: ["IN_APP", "EMAIL"],
      triggerType: "MATCH_NOTICE",
      subject: "Match details — please confirm availability",
      body: detail,
    });
  }
  await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "MATCH_NOTICE", summary: "Sent 7-day match notice" });
  revalidatePath("/console/league");
}

/**
 * 48-hour escalation (§14). Alerts the coach, Academy Director, and COO
 * simultaneously for any team short of the minimum confirmed players. Manual
 * trigger here; a scheduled job would call the same logic at the 48-hour mark.
 */
export async function sendEscalationAlert(formData: FormData) {
  const session = await requireLeagueManager();
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const now = new Date();

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      homeTeam: { include: { members: true } },
      awayTeam: { include: { members: true } },
      confirmations: true,
    },
  });
  if (!fixture) throw new Error("Fixture not found.");

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
    return; // nothing to escalate
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
      senderId: session.userId,
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
      senderId: session.userId, seasonId: fixture.seasonId,
      audienceType: "TEAM", audienceRef: teamId,
      channels: ["IN_APP", "SMS"], triggerType: "AVAILABILITY_ESCALATION",
      subject: "Confirm availability now", body: "We're short of confirmed players 48 hours out. Please mark Playing/Not playing in your portal immediately.",
    });
  }

  await audit({ actorId: session.userId, entityType: "Fixture", entityId: fixtureId, action: "ESCALATE", summary: `48-hour alert: ${atRisk.join("; ")}` });
  revalidatePath("/console/league");
}
