// Centralized enum-like value sets. Because dev runs on SQLite (no native
// enums), these are the authoritative allowed values, validated in app code.

export const ROLES = {
  COO: "COO",
  CEO: "CEO",
  DIRECTOR: "DIRECTOR",
  COACH: "COACH",
  PLAYER: "PLAYER",
  PARENT: "PARENT",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  COO: "Chief Operating Officer",
  CEO: "Chief Executive Officer",
  DIRECTOR: "Academy Director",
  COACH: "Coach",
  PLAYER: "Player",
  PARENT: "Parent / Guardian",
};

// Staff roles have console access; player/parent get the family portal.
export const STAFF_ROLES: Role[] = ["COO", "CEO", "DIRECTOR", "COACH"];
export const ADMIN_ROLES: Role[] = ["COO", "CEO", "DIRECTOR"];

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

export const TEAM_CAP = 8;
export const TEAM_MIN = 6;
export const SEASON_FEE_CENTS = 49500;
export const COACH_PER_SESSION_CENTS = 10000;
