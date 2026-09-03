import "server-only";
import { prisma } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/enums";

// Who-can-message-whom for on-platform direct messaging.
//   ADMIN  ↔ anyone (also the moderator: can read every conversation)
//   COACH  ↔ other coaches, admins, parents of players on their teams, and the
//            players 12+ on their teams
//   PARENT ↔ admins, their children's coaches, and other parents on those teams
//   PLAYER (12+) ↔ admins and their own team's coaches
//   PLAYER (under 12) → no direct messages; their parent is the contact instead
// A person is reachable only if they have an active account AND (for a player)
// are at least MESSAGING_MIN_AGE, so a young child never appears as a contact.

export const MESSAGING_MIN_AGE = 12;

export type MsgRole = "ADMIN" | "COACH" | "PARENT" | "PLAYER" | "NONE";
export type Contact = { personId: string; name: string; role: MsgRole };

/** Whole years old as of today, or null when no birthdate is on file. */
export function ageFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** A player is old enough to hold their own conversations when their age is
 *  unknown (adult players carry no DOB) or at least MESSAGING_MIN_AGE. Only a
 *  confirmed under-12 is excluded. */
export function playerOldEnough(age: number | null): boolean {
  return age === null || age >= MESSAGING_MIN_AGE;
}

export function normalizeMsgRole(role: string | null | undefined): MsgRole {
  if (!role) return "NONE";
  if (ADMIN_ROLES.includes(role as never)) return "ADMIN";
  if (role === "COACH") return "COACH";
  if (role === "PARENT") return "PARENT";
  if (role === "PLAYER") return "PLAYER";
  return "NONE";
}

/** Role-only gate: staff and parents always; a PLAYER's eligibility depends on
 *  age (see canUseMessagingPerson), so this returns false for PLAYER. */
export function canUseMessaging(role: string | null | undefined): boolean {
  const r = normalizeMsgRole(role);
  return r === "ADMIN" || r === "COACH" || r === "PARENT";
}

/** Age-aware gate for a specific account holder — the one the portal uses so a
 *  player 12+ gets messaging while an under-12 does not. */
export async function canUseMessagingPerson(personId: string, role: string | null | undefined): Promise<boolean> {
  const r = normalizeMsgRole(role);
  if (r === "ADMIN" || r === "COACH" || r === "PARENT") return true;
  if (r !== "PLAYER" || !personId) return false;
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { dob: true } });
  return playerOldEnough(ageFromDob(person?.dob));
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeMsgRole(role) === "ADMIN";
}

/** Everyone with an active login who can hold a conversation, keyed by personId.
 *  Includes players 12+ (an under-12 is left out, so they never appear as a
 *  contact and their parent is messaged instead). */
async function eligibleUniverse(): Promise<Map<string, Contact>> {
  const users = await prisma.user.findMany({
    where: { active: true, personId: { not: null } },
    select: { role: true, person: { select: { id: true, firstName: true, lastName: true, dob: true } } },
  });
  const map = new Map<string, Contact>();
  for (const u of users) {
    if (!u.person) continue;
    const r = normalizeMsgRole(u.role);
    if (r === "ADMIN" || r === "COACH" || r === "PARENT") {
      map.set(u.person.id, { personId: u.person.id, name: `${u.person.firstName} ${u.person.lastName}`, role: r });
    } else if (r === "PLAYER" && playerOldEnough(ageFromDob(u.person.dob))) {
      map.set(u.person.id, { personId: u.person.id, name: `${u.person.firstName} ${u.person.lastName}`, role: r });
    }
  }
  return map;
}

/** Team ids a player is rostered on. */
async function playerTeamIds(playerPersonId: string): Promise<string[]> {
  const members = await prisma.teamMember.findMany({ where: { personId: playerPersonId }, select: { teamId: true } });
  return [...new Set(members.map((m) => m.teamId))];
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

/** The coaches, parents (guardians of players), and the players themselves
 *  attached to a set of teams. Players are surfaced too so a coach can message
 *  a 12+ player directly (the universe filter keeps under-12s out). */
async function teamContacts(teamIds: string[]): Promise<{ parents: Set<string>; coaches: Set<string>; players: Set<string> }> {
  const parents = new Set<string>();
  const coaches = new Set<string>();
  const players = new Set<string>();
  if (!teamIds.length) return { parents, coaches, players };
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: {
      coach: { select: { personId: true } },
      assistantCoaches: { select: { coach: { select: { personId: true } } } },
      members: { select: { personId: true, person: { select: { guardianId: true } } } },
    },
  });
  for (const t of teams) {
    if (t.coach?.personId) coaches.add(t.coach.personId);
    for (const a of t.assistantCoaches) if (a.coach?.personId) coaches.add(a.coach.personId);
    for (const m of t.members) {
      players.add(m.personId);
      if (m.person.guardianId) parents.add(m.person.guardianId);
    }
  }
  return { parents, coaches, players };
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
    // Parents and the 12+ players on the coach's teams.
    const { parents, players } = await teamContacts(await coachTeamIds(actorPersonId));
    for (const p of parents) if (universe.has(p)) ids.add(p);
    for (const p of players) if (universe.has(p)) ids.add(p);
  } else if (role === "PARENT") {
    const { parents, coaches } = await teamContacts(await parentTeamIds(actorPersonId));
    for (const p of parents) if (universe.has(p)) ids.add(p);
    for (const c of coaches) if (universe.has(c)) ids.add(c);
  } else if (role === "PLAYER") {
    // A player (12+) reaches admins and the coaches of their own teams.
    const { coaches } = await teamContacts(await playerTeamIds(actorPersonId));
    for (const c of coaches) if (universe.has(c)) ids.add(c);
  }
  ids.delete(actorPersonId);
  return ids;
}

/** People this actor may start a conversation with, sorted by name. */
export async function allowedContacts(actorPersonId: string, role: string): Promise<Contact[]> {
  const r = normalizeMsgRole(role);
  if (r === "NONE") return [];
  // An under-12 player has no direct messaging — their parent is the contact.
  if (r === "PLAYER" && !(await canUseMessagingPerson(actorPersonId, role))) return [];
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
