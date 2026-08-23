import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "./auth";
import { ADMIN_ROLES, STAFF_ROLES, type Role } from "./enums";

/**
 * Role permission matrix (spec §17), consolidated:
 *   ADMIN    — everything (replaces the former COO / CEO / DIRECTOR roles)
 *   COACH    — own teams, own roster, own sessions, attendance, own earnings
 *   PLAYER   — own record, own team, own schedule, own payments
 *   PARENT   — same scope as their linked minors
 * The legacy COO/CEO/DIRECTOR strings remain in each list so any un-migrated
 * login keeps working; they are equivalent to ADMIN.
 */
const ADMIN: Role[] = ["ADMIN", "COO", "CEO", "DIRECTOR"];
export const CAN: Record<string, Role[]> = {
  viewAllFinancials: ADMIN,
  manageFacilities: ADMIN,
  manageAgreements: ADMIN,
  manageTeams: ADMIN,
  manageCoaches: ADMIN,
  manageUsers: ADMIN,
  managePlayers: ADMIN,
  manageScheduling: ADMIN,
  manageEvaluations: ADMIN,
  manageAlaCarte: ADMIN,
  runPayouts: ADMIN,
  broadcastAll: ADMIN,
  overrideEligibility: ADMIN,
  // Platform super-admin: manage the licensed organizations (tenants). Restricted
  // to top-level admins; in Phase 2 this also requires membership in the primary
  // org so a licensed customer's own admin can never manage other tenants.
  manageOrganizations: ADMIN,
  markAttendance: [...ADMIN, "COACH"],
  viewOwnEarnings: [...ADMIN, "COACH"],
};

// All role checks accept either a single role or a set (multi-role users).
// With a set, access is granted if ANY held role satisfies the check.
function asList(role: Role | Role[]): Role[] {
  return Array.isArray(role) ? role : [role];
}

export function can(role: Role | Role[], action: keyof typeof CAN): boolean {
  const allowed = CAN[action] ?? [];
  return asList(role).some((r) => allowed.includes(r));
}

export function isStaff(role: Role | Role[]) {
  return asList(role).some((r) => STAFF_ROLES.includes(r));
}
export function isAdmin(role: Role | Role[]) {
  return asList(role).some((r) => ADMIN_ROLES.includes(r));
}

/** Require any authenticated session; redirect to /login otherwise. */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Require a staff/admin console user. */
export async function requireStaff(): Promise<SessionPayload> {
  const session = await requireUser();
  if (!isStaff(session.roles ?? [session.role])) redirect("/portal");
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireUser();
  if (!isAdmin(session.roles ?? [session.role])) redirect("/console");
  return session;
}
