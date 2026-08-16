import "server-only";
import { prisma } from "@/lib/db";
import { teamMissingFields, canPublishTeam } from "./teams";

// ONE counting service for the whole console. Before this, the dashboard, Season
// Setup, Registrations, Teams, Schedule and Reports each ran their own count
// queries with different scopes, so "how many registrations / teams / unassigned"
// disagreed depending on which page you stood on. Every summary number and every
// getting-started checklist now reads from here, against ONE canonical scope:
//
//   • the active PURE Academy season only, and
//   • real teams only (isTest = false), and
//   • live registrations only (withdrawn / duplicate / merged excluded).
//
// Detail queries (the actual rows a page lists and edits) still live on each
// page — this owns the headline numbers and the readiness milestones, nothing else.

/** Registration statuses that are NOT live signups. Mirrors enrollmentBreakdown. */
export const DEAD_REG_STATUS = ["WITHDRAWN", "DUPLICATE", "MERGED"] as const;
/** The "awaiting placement" pool — a registration is unassigned until it lands on a team. */
export const UNASSIGNED_STATUS = ["SUBMITTED", "WAITLISTED"] as const;

export type ReadinessStep = {
  key: string;
  label: string;
  href: string;
  hint: string;
  done: boolean;
};

export type SeasonStats = {
  season: { id: string; name: string } | null;
  divisions: number;
  registrations: {
    /** Live registration rows (a person with two signups counts twice). */
    live: number;
    /** Distinct live people (the "how many kids" number). */
    people: number;
    assigned: number;
    waitlisted: number;
    /** Awaiting placement (SUBMITTED ∪ WAITLISTED). */
    unassigned: number;
  };
  coaches: number;
  facilities: { total: number; executed: number; pending: number };
  teams: {
    total: number;
    /** All required fields set. */
    ready: number;
    /** Missing at least one required field. */
    building: number;
    published: number;
    /** Complete + facility agreement executed, not yet published. */
    eligibleToPublish: number;
    withoutPlayers: number;
  };
  sessions: number;
  /** Registered people with no signed waiver (unscoped — matches Compliance). */
  waiversOutstanding: number;
  /** The one getting-started sequence. Every page renders a slice of this. */
  readiness: ReadinessStep[];
};

function emptyStats(): SeasonStats {
  return {
    season: null,
    divisions: 0,
    registrations: { live: 0, people: 0, assigned: 0, waitlisted: 0, unassigned: 0 },
    coaches: 0,
    facilities: { total: 0, executed: 0, pending: 0 },
    teams: { total: 0, ready: 0, building: 0, published: 0, eligibleToPublish: 0, withoutPlayers: 0 },
    sessions: 0,
    waiversOutstanding: 0,
    readiness: [
      { key: "season", label: "Create & activate your season", href: "/console/setup", hint: "Season Setup", done: false },
    ],
  };
}

/**
 * The single source of truth for every headline count and readiness checkmark in
 * the console. Call it once per page (it runs a handful of parallel queries) and
 * read whatever you need off the result.
 */
export async function getSeasonStats(): Promise<SeasonStats> {
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    include: { _count: { select: { divisions: true } } },
  });
  if (!season) return emptyStats();
  const seasonId = season.id;

  // Live registrations in this season (dead statuses excluded).
  const liveWhere = { seasonId, status: { notIn: [...DEAD_REG_STATUS] } };

  const [
    liveRegs,
    distinctPeople,
    assigned,
    waitlisted,
    unassigned,
    coaches,
    facilities,
    teams,
    sessions,
    waiversOutstanding,
  ] = await Promise.all([
    prisma.registration.count({ where: liveWhere }),
    prisma.registration.findMany({ where: liveWhere, select: { personId: true }, distinct: ["personId"] }),
    prisma.registration.count({ where: { seasonId, status: "ASSIGNED" } }),
    prisma.registration.count({ where: { seasonId, status: "WAITLISTED" } }),
    prisma.registration.count({ where: { seasonId, status: { in: [...UNASSIGNED_STATUS] } } }),
    prisma.coach.count(),
    prisma.facility.findMany({ where: { archived: false }, select: { agreementStatus: true } }),
    // Real teams in this season only.
    prisma.team.findMany({
      where: { seasonId, isTest: false },
      include: { _count: { select: { members: true } }, facility: { select: { agreementStatus: true } } },
    }),
    prisma.session.count({ where: { seasonId } }),
    // Registered people with no signed waiver — unscoped, matching Compliance.
    prisma.person.count({ where: { waiverSignedAt: null, registrations: { some: {} } } }),
  ]);

  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED").length;

  const teamsReady = teams.filter((t) => teamMissingFields(t).length === 0).length;
  const teamsPublished = teams.filter((t) => t.published).length;
  const teamsEligible = teams.filter((t) => canPublishTeam(t, t.facility).ok && !t.published).length;
  const teamsWithoutPlayers = teams.filter((t) => (t._count?.members ?? 0) === 0).length;

  const stats: SeasonStats = {
    season: { id: season.id, name: season.name },
    divisions: season._count.divisions,
    registrations: {
      live: liveRegs,
      people: distinctPeople.length,
      assigned,
      waitlisted,
      unassigned,
    },
    coaches,
    facilities: { total: facilities.length, executed, pending: facilities.length - executed },
    teams: {
      total: teams.length,
      ready: teamsReady,
      building: teams.length - teamsReady,
      published: teamsPublished,
      eligibleToPublish: teamsEligible,
      withoutPlayers: teamsWithoutPlayers,
    },
    sessions,
    waiversOutstanding,
    readiness: [],
  };

  // The one getting-started sequence. Each milestone is computed once here so the
  // dashboard, Season Setup, Teams and Schedule can never disagree about whether
  // a step is done. Semantics are "you've meaningfully done this" (≥1), matching
  // the dashboard's original flow — pages that want a stricter "all done" number
  // (e.g. 18 teams still building) read the granular counts above, not this list.
  stats.readiness = [
    { key: "season", label: "Create & activate your season", href: "/console/setup", hint: "Season Setup", done: true },
    { key: "divisions", label: "Add divisions (skill bands / levels)", href: "/console/setup", hint: "Season Setup", done: stats.divisions > 0 },
    { key: "registrations", label: "Bring in registrations — import or add players", href: "/console/registrations", hint: "Registrations", done: stats.registrations.live > 0 },
    { key: "coaches", label: "Add your coaches", href: "/console/coaches", hint: "Coaches", done: stats.coaches > 0 },
    { key: "facilities", label: "Add facilities & execute agreements", href: "/console/facilities", hint: "Facilities", done: stats.facilities.executed > 0 },
    { key: "assign", label: "Assign players into teams", href: "/console/board", hint: "Assignment", done: stats.registrations.assigned > 0 },
    // Completion gates use "all done" semantics — the step isn't done until every
    // team is complete / published — so the Teams page and dashboard agree.
    { key: "teamsComplete", label: "Complete each team's required fields", href: "/console/teams", hint: "Teams", done: stats.teams.total > 0 && stats.teams.building === 0 },
    { key: "schedule", label: "Generate the practice schedule", href: "/console/schedule", hint: "Schedule", done: stats.sessions > 0 },
    { key: "published", label: "Publish teams to families", href: "/console/teams", hint: "Teams", done: stats.teams.total > 0 && stats.teams.published === stats.teams.total },
  ];

  return stats;
}

/** Convenience: pull just the readiness steps whose keys you name, in order. */
export function readinessSlice(stats: SeasonStats, keys: string[]): ReadinessStep[] {
  return keys.map((k) => stats.readiness.find((s) => s.key === k)).filter((s): s is ReadinessStep => !!s);
}
