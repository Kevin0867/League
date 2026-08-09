import "server-only";
import { prisma } from "../db";

// Audience resolution (§13). Turns an audience selection into the set of people
// who should receive a message. For team, player, and division audiences, minors
// expand to include their parent/guardian — "PURE → a team (players plus parents
// of minors)."

export type AudienceType =
  | "ALL_PLAYERS"
  | "ALL_COACHES"
  | "MARKET"
  | "DIVISION"
  | "TEAM"
  | "SINGLE_COACH"
  | "SINGLE_PERSON";

export type Recipient = {
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
};

async function expandGuardians(personIds: string[]): Promise<string[]> {
  if (personIds.length === 0) return [];
  const minors = await prisma.person.findMany({
    where: { id: { in: personIds }, isMinor: true, guardianId: { not: null } },
    select: { guardianId: true },
  });
  const guardianIds = minors.map((m) => m.guardianId!).filter(Boolean);
  return [...new Set([...personIds, ...guardianIds])];
}

async function toRecipients(personIds: string[]): Promise<Recipient[]> {
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return [];
  const people = await prisma.person.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  return people.map((p) => ({
    personId: p.id,
    name: `${p.firstName} ${p.lastName}`,
    email: p.email,
    phone: p.phone,
  }));
}

export async function resolveAudience(
  type: AudienceType,
  ref: string | null,
  seasonId: string | null
): Promise<Recipient[]> {
  let personIds: string[] = [];
  let expandMinors = true;

  switch (type) {
    case "ALL_PLAYERS": {
      const regs = await prisma.registration.findMany({
        where: seasonId ? { seasonId } : {},
        select: { personId: true },
      });
      personIds = regs.map((r) => r.personId);
      break;
    }
    case "ALL_COACHES": {
      const coaches = await prisma.coach.findMany({ select: { personId: true } });
      personIds = coaches.map((c) => c.personId);
      expandMinors = false;
      break;
    }
    case "DIVISION": {
      if (!ref) break;
      const regs = await prisma.registration.findMany({
        where: { divisionId: ref },
        select: { personId: true },
      });
      personIds = regs.map((r) => r.personId);
      break;
    }
    case "MARKET": {
      if (!ref) break;
      const teams = await prisma.team.findMany({
        where: { market: ref },
        select: { members: { select: { personId: true } } },
      });
      personIds = teams.flatMap((t) => t.members.map((m) => m.personId));
      break;
    }
    case "TEAM": {
      if (!ref) break;
      const team = await prisma.team.findUnique({
        where: { id: ref },
        select: { members: { select: { personId: true } }, teamContactId: true, coach: { select: { personId: true } } },
      });
      if (team) {
        personIds = team.members.map((m) => m.personId);
        if (team.teamContactId) personIds.push(team.teamContactId);
        if (team.coach) personIds.push(team.coach.personId);
      }
      break;
    }
    case "SINGLE_COACH": {
      if (!ref) break;
      const coach = await prisma.coach.findUnique({ where: { id: ref }, select: { personId: true } });
      if (coach) personIds = [coach.personId];
      expandMinors = false;
      break;
    }
    case "SINGLE_PERSON": {
      if (ref) personIds = [ref];
      break;
    }
  }

  if (expandMinors) personIds = await expandGuardians(personIds);
  return toRecipients(personIds);
}
