// Team completeness & assignment gates — the custom logic the spec says nothing
// off-the-shelf does (§4, §20).
import { TEAM_CAP, TEAM_MAX, TEAM_MIN } from "../enums";

export type TeamLike = {
  divisionId: string | null;
  levelBand: string | null;
  market: string | null;
  coachId: string | null;
  facilityId: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  origin: string;
  coachPlays: boolean;
  _count?: { members: number };
};

export type FacilityAgreement = { agreementStatus: string } | null | undefined;

/**
 * A team is complete only when all six fields are set (§2). For outside ACP
 * teams a coach is not required — a team contact stands in — so coach is only
 * required for PURE Academy teams.
 */
export function teamMissingFields(team: TeamLike): string[] {
  const missing: string[] = [];
  if (!team.divisionId) missing.push("division");
  if (!team.levelBand) missing.push("level band");
  if (!team.market) missing.push("market");
  if (team.origin === "PURE_ACADEMY" && !team.coachId) missing.push("coach");
  if (!team.facilityId) missing.push("facility");
  if (!team.dayOfWeek) missing.push("day");
  if (!team.startTime) missing.push("time");
  return missing;
}

export function isTeamComplete(team: TeamLike): boolean {
  return teamMissingFields(team).length === 0;
}

/**
 * Roster sizing (§2/§4): cap 8, min 6. Where the coach plays, the coach fills a
 * slot: 7 players + coach fills it, 5 players + coach meets the minimum.
 */
export function rosterStatus(playerCount: number, coachPlays: boolean) {
  const effective = playerCount + (coachPlays ? 1 : 0);
  return {
    playerCount,
    effective,
    atCap: effective >= TEAM_CAP,
    // Over the target of 8 but within the admin ceiling of 10 — a temporary
    // add-then-move state the board flags.
    overCap: effective > TEAM_CAP,
    atMax: effective >= TEAM_MAX,
    meetsMinimum: effective >= TEAM_MIN,
    needed: Math.max(0, TEAM_MIN - effective),
  };
}

/**
 * Team publication gate (§4): a team cannot be published to families until it is
 * complete and its facility agreement is executed. There is no roster-minimum
 * gate — a team can be launched/published with any number of players.
 * `playerCount` is retained for signature compatibility (roster size).
 */
export function canPublishTeam(
  team: TeamLike,
  facility: FacilityAgreement,
  _playerCount = team._count?.members ?? 0
): { ok: boolean; reason?: string } {
  if (!isTeamComplete(team)) {
    return { ok: false, reason: `Missing: ${teamMissingFields(team).join(", ")}` };
  }
  if (!facility || facility.agreementStatus !== "EXECUTED") {
    return {
      ok: false,
      reason: "Facility agreement is not executed — cannot publish to families.",
    };
  }
  return { ok: true };
}

/**
 * Coach assignment hard gate (§5): no coach is assigned to a team without a
 * completed, unexpired background check.
 */
export function coachAssignmentGate(coach: {
  backgroundCheckDate: Date | null;
  backgroundCheckExpiry: Date | null;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!coach.backgroundCheckDate) reasons.push("no background check on file");
  if (coach.backgroundCheckExpiry && coach.backgroundCheckExpiry < new Date())
    reasons.push("background check expired");
  return { ok: reasons.length === 0, reasons };
}
