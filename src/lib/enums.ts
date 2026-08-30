// Centralized enum-like value sets. Because dev runs on SQLite (no native
// enums), these are the authoritative allowed values, validated in app code.

export const ROLES = {
  ADMIN: "ADMIN",
  COACH: "COACH",
  PLAYER: "PLAYER",
  PARENT: "PARENT",
  // Legacy executive roles, consolidated into ADMIN. Still recognized so any
  // un-migrated account keeps full admin access, but never offered in the UI.
  COO: "COO",
  CEO: "CEO",
  DIRECTOR: "DIRECTOR",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  COACH: "Coach",
  PLAYER: "Player",
  PARENT: "Parent / Guardian",
  // Legacy roles display as Admin (they are consolidated into it).
  COO: "Admin",
  CEO: "Admin",
  DIRECTOR: "Admin",
};

// The only roles a human assigns in the UI — the three legacy admin roles are
// consolidated into a single ADMIN.
export const ASSIGNABLE_ROLES: Role[] = ["ADMIN", "COACH", "PLAYER", "PARENT"];

// Staff roles have console access; player/parent get the family portal.
// Legacy admin roles remain in these sets so historical logins still resolve.
export const STAFF_ROLES: Role[] = ["ADMIN", "COACH", "COO", "CEO", "DIRECTOR"];
export const ADMIN_ROLES: Role[] = ["ADMIN", "COO", "CEO", "DIRECTOR"];

// A person can hold several roles at once (e.g. an admin who also coaches, a
// parent who also coaches). We store one primary `role` plus `extraRoles[]`;
// the effective set is their union. When a single role must stand in for the
// set (legacy checks, display), we pick the highest-priority one.
export const ROLE_PRIORITY: Role[] = ["ADMIN", "COO", "CEO", "DIRECTOR", "COACH", "PARENT", "PLAYER"];

/** The union of a user's primary role and any extra roles, de-duped. */
export function effectiveRoles(user: { role: string; extraRoles?: string[] | null }): Role[] {
  const set = new Set<string>([user.role, ...(user.extraRoles ?? [])].filter(Boolean));
  return [...set] as Role[];
}

/** The highest-priority role in a set — the primary/display role. */
export function primaryRole(roles: Role[]): Role {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return roles[0] ?? "PLAYER";
}

/** Normalize a chosen set of assignable roles into { role, extraRoles }. */
export function splitRoles(roles: Role[]): { role: Role; extraRoles: Role[] } {
  const uniq = [...new Set(roles)] as Role[];
  const role = primaryRole(uniq);
  return { role, extraRoles: uniq.filter((r) => r !== role) };
}

/// Markets (cities) the academy serves — the location options players rank on
/// the registration form. Facility-specific assignments happen later.
export const ACADEMY_MARKETS = ["Scottsdale", "Phoenix", "Gilbert", "Mesa"] as const;

export const AGREEMENT_STATUS = [
  "IDENTIFIED",
  "VERBAL",
  "AGREEMENT_SENT",
  "EXECUTED",
] as const;

export const FEE_BASIS = [
  "NONE",
  "PER_COURT",
  "PER_HOUR",
  "PER_SESSION",
  "PERCENTAGE",
] as const;

export const SESSION_TYPE = [
  "PRACTICE",
  "LEAGUE_MATCH",
  "CHAMPIONSHIP",
  "ALA_CARTE",
] as const;

export const SESSION_STATUS = [
  "SCHEDULED",
  "DELIVERED",
  "CANCELLED",
  "RESCHEDULED",
] as const;

export const CANCEL_REASON = [
  "HEAT",
  "WEATHER",
  "FACILITY_CLOSURE",
  "SAFETY",
  "OTHER",
] as const;

export const REGISTRATION_STATUS = [
  "SUBMITTED",
  "DUPLICATE",
  "MERGED",
  "ASSIGNED",
  "WAITLISTED",
  "WITHDRAWN",
] as const;

export const FIXTURE_STATUS = [
  "SCHEDULED",
  "CONFIRMED",
  "RESCHEDULED",
  "FORFEITED",
  "COMPLETED",
] as const;

export const AVAILABILITY_STATUS = [
  "PLAYING",
  "NOT_PLAYING",
  "UNCONFIRMED",
] as const;

export const TEAM_ORIGIN = ["PURE_ACADEMY", "ACP_CLUB"] as const;

export const WEEKDAYS = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const;

// The six fields that make a team "complete" (§2).
export const TEAM_COMPLETION_FIELDS = [
  "divisionId",
  "levelBand",
  "market",
  "coachId",
  "facilityId",
  "dayOfWeek",
] as const;

// Target roster size — what open-spot counts, public signup links, and the
// waitlist gate use. A team "fills" at 8.
export const TEAM_CAP = 8;
// Admin hard ceiling. Staff can manually push a roster to 10 (over the target)
// so they can add a player and then move another off — a temporary overage the
// board flags as "over cap". Public/self-serve signups never exceed TEAM_CAP.
export const TEAM_MAX = 10;
export const TEAM_MIN = 6;
export const SEASON_FEE_CENTS = 49500;
export const COACH_PER_SESSION_CENTS = 10000;
