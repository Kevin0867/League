import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "./auth";
import { ADMIN_ROLES, STAFF_ROLES, type Role } from "./enums";

/**
 * Role permission matrix (spec §17).
 *   COO      — everything
 *   CEO      — facilities, agreements, financials
 *   DIRECTOR — teams, coaches, players, scheduling, evaluations, à la carte
 *   COACH    — own teams, own roster, own sessions, attendance, own earnings
 *   PLAYER   — own record, own team, own schedule, own payments
 *   PARENT   — same scope as their linked minors
 */
export const CAN: Record<string, Role[]> = {
  viewAllFinancials: ["COO", "CEO"],
  manageFacilities: ["COO", "CEO"],
  manageAgreements: ["COO", "CEO"],
  manageTeams: ["COO", "DIRECTOR"],
  manageCoaches: ["COO", "DIRECTOR"],
  manageUsers: ["COO", "DIRECTOR"], // assign roles/access; admin roles are COO-only (enforced in the route)
  managePlayers: ["COO", "DIRECTOR"],
  manageScheduling: ["COO", "DIRECTOR"],
  manageEvaluations: ["COO", "DIRECTOR"],
  manageAlaCarte: ["COO", "DIRECTOR"],
  runPayouts: ["COO", "DIRECTOR"],
  broadcastAll: ["COO", "DIRECTOR"],
  overrideEligibility: ["COO", "DIRECTOR"], // requires BOTH per §12 in practice
  markAttendance: ["COO", "DIRECTOR", "COACH"],
  viewOwnEarnings: ["COO", "DIRECTOR", "COACH"],
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
