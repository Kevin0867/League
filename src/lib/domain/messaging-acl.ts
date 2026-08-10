import "server-only";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/enums";

// Who-can-message-whom for on-platform direct messaging.
//   ADMIN  ↔ anyone (also the moderator: can read every conversation)
//   COACH  ↔ other coaches, admins, and parents of players on their teams
//   PARENT ↔ admins, their children's coaches, and other parents on those teams
//   PLAYER → no messaging (minors excluded for now)
// Only people with an active account in {ADMIN, COACH, PARENT} are reachable —
// a player has no inbox to read, so they never appear as a contact.

export type MsgRole = "ADMIN" | "COACH" | "PARENT" | "PLAYER" | "NONE";
export type Contact = { personId: string; name: string; role: MsgRole };

export function normalizeMsgRole(role: string | null | undefined): MsgRole {
  if (!role) return "NONE";
  if (ADMIN_ROLES.includes(role as never)) return "ADMIN";
  if (role === "COACH") return "COACH";
  if (role === "PARENT") return "PARENT";
  if (role === "PLAYER") return "PLAYER";
  return "NONE";
}

export function canUseMessaging(role: string | null | undefined): boolean {
  const r = normalizeMsgRole(role);
  return r === "ADMIN" || r === "COACH" || r === "PARENT";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeMsgRole(role) === "ADMIN";
}

/** Everyone with an active login who can hold a conversation, keyed by personId. */
async function eligibleUniverse(): Promise<Map<string, Contact>> {
  const users = await prisma.user.findMany({
    where: { active: true, personId: { not: null } },
    select: { role: true, person: { select: { id: true, firstName: true, lastName: true } } },
  });
  const map = new Map<string, Contact>();
  for (const u of users) {
    if (!u.person) continue;
    const r = normalizeMsgRole(u.role);
    if (r === "ADMIN" || r === "COACH" || r === "PARENT") {
      map.set(u.person.id, {
        personId: u.person.id,
        name: `${u.person.firstName} ${u.person.lastName}`,
        role: r,
      });
    }
  }
  return map;
}

/** Team ids a coach is on (head coach or assistant). */
async function coachTeamIds(coachPersonId: string): Promise<string[]> {
  const coach = await prisma.coach.findUnique({ where: { personId: coachPersonId }, select: { id: true } });
  if (!coach) return [];
  const teams = await prisma.team.findMany({
    where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
    select: { id: true },
  });
  return teams.map((t) => t.id);
}

/** Team ids a parent's children are rostered on. */
async function parentTeamIds(parentPersonId: string): Promise<string[]> {
  const kids = await prisma.person.findMany({ where: { guardianId: parentPersonId }, select: { id: true } });
  if (!kids.length) return [];
  const members = await prisma.teamMember.findMany({
    where: { personId: { in: kids.map((k) => k.id) } },
    select: { teamId: true },
  });
  return [...new Set(members.map((m) => m.teamId))];
}

/** The coaches and parents (guardians of players) attached to a set of teams. */
async function teamContacts(teamIds: string[]): Promise<{ parents: Set<string>; coaches: Set<string> }> {
  const parents = new Set<string>();
  const coaches = new Set<string>();
  if (!teamIds.length) return { parents, coaches };
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: {
      coach: { select: { personId: true } },
      assistantCoaches: { select: { coach: { select: { personId: true } } } },
      members: { select: { person: { select: { guardianId: true } } } },
    },
  });
  for (const t of teams) {
    if (t.coach?.personId) coaches.add(t.coach.personId);
    for (const a of t.assistantCoaches) if (a.coach?.personId) coaches.add(a.coach.personId);
    for (const m of t.members) if (m.person.guardianId) parents.add(m.person.guardianId);
  }
  return { parents, coaches };
}

async function allowedIds(
  universe: Map<string, Contact>,
  actorPersonId: string,
  role: MsgRole
): Promise<Set<string>> {
  if (role === "ADMIN") {
    const all = new Set(universe.keys());
    all.delete(actorPersonId);
    return all;
  }
  const ids = new Set<string>();
  // Everyone may reach admins.
  for (const [pid, c] of universe) if (c.role === "ADMIN") ids.add(pid);

  if (role === "COACH") {
    for (const [pid, c] of universe) if (c.role === "COACH") ids.add(pid);
    const { parents } = await teamContacts(await coachTeamIds(actorPersonId));
    for (const p of parents) if (universe.has(p)) ids.add(p);
  } else if (role === "PARENT") {
    const { parents, coaches } = await teamContacts(await parentTeamIds(actorPersonId));
    for (const p of parents) if (universe.has(p)) ids.add(p);
    for (const c of coaches) if (universe.has(c)) ids.add(c);
  }
  ids.delete(actorPersonId);
  return ids;
}

/** People this actor may start a conversation with, sorted by name. */
export async function allowedContacts(actorPersonId: string, role: string): Promise<Contact[]> {
  const r = normalizeMsgRole(role);
  if (r === "NONE" || r === "PLAYER") return [];
  const universe = await eligibleUniverse();
  const ids = await allowedIds(universe, actorPersonId, r);
  return [...ids]
    .map((id) => universe.get(id))
    .filter((c): c is Contact => !!c)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether the actor is permitted to open a conversation with a specific person. */
export async function canReachPerson(actorPersonId: string, role: string, targetPersonId: string): Promise<boolean> {
  if (targetPersonId === actorPersonId) return false;
  const contacts = await allowedContacts(actorPersonId, role);
  return contacts.some((c) => c.personId === targetPersonId);
}
