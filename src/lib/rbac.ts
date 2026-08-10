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
  markAttendance: [...ADMIN, "COACH"],
  viewOwnEarnings: [...ADMIN, "COACH"],
};

export function can(role: Role, action: keyof typeof CAN): boolean {
  return CAN[action]?.includes(role) ?? false;
}

export function isStaff(role: Role) {
  return STAFF_ROLES.includes(role);
}
export function isAdmin(role: Role) {
  return ADMIN_ROLES.includes(role);
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
  if (!isStaff(session.role)) redirect("/portal");
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireUser();
  if (!isAdmin(session.role)) redirect("/console");
  return session;
}
