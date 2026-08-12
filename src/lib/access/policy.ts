// Console access policy — the single source of truth for which roles may open
// which console pages. Edge-safe (no server-only / Prisma imports) so it can run
// in middleware. API route handlers keep their own can()/capability guards for
// mutations; this governs PAGE (read) access, which is where the leak was.
//
// Roles:
//   ADMIN (+ legacy COO/CEO/DIRECTOR) — full console.
//   COACH — a restricted console: their dashboard, the season, teams/schedule/
//           league (view + their roster & progress notes), their profile, inbox.
//   PLAYER / PARENT — no console; they belong in /portal.

export const ADMIN_ROLES = ["ADMIN", "COO", "CEO", "DIRECTOR"];
export const COACH_ROLE = "COACH";

// Console sections a COACH may open. Everything else under /console is admin-
// only. The bare "/console" dashboard is always allowed for a coach.
export const COACH_CONSOLE_PREFIXES = [
  "/console/calendar", // season calendar (view)
  "/console/schedule", // their practices
  "/console/league", // league standings/fixtures (view)
  "/console/teams", // teams (view others; their roster + progress notes)
  "/console/profile", // their own coach profile & account
  "/console/inbox", // messaging with admins/coaches/their team families
];

export function isAdminRole(roles: string[]): boolean {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}
export function isCoachRole(roles: string[]): boolean {
  return roles.includes(COACH_ROLE);
}
export function isStaffRole(roles: string[]): boolean {
  return isAdminRole(roles) || isCoachRole(roles);
}

/** Whether a coach-only user may open a given console pathname. */
export function coachMayOpen(pathname: string): boolean {
  if (pathname === "/console" || pathname === "/console/") return true;
  return COACH_CONSOLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export type ConsoleDecision = "allow" | "toLogin" | "toPortal" | "toConsoleHome";

// Decide access to a /console/* PAGE for the given held roles.
export function decideConsoleAccess(pathname: string, roles: string[] | null | undefined): ConsoleDecision {
  if (!roles || roles.length === 0) return "toLogin";
  if (isAdminRole(roles)) return "allow"; // admins see the whole console
  if (isCoachRole(roles)) return coachMayOpen(pathname) ? "allow" : "toConsoleHome";
  return "toPortal"; // players / parents don't belong in the console
}
