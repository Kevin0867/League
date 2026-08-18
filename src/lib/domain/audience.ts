import "server-only";
import { prisma } from "../db";
import { ADMIN_ROLES } from "../enums";

// Audience resolution (§13). Turns an audience selection into the set of people
// who should receive a message. For team, player, and division audiences, minors
// expand to include their parent/guardian — "PURE → a team (players plus parents
// of minors)."

export type AudienceType =
  | "ALL_PLAYERS"
  | "ALL_COACHES"
  | "ALL_ADMINS"
  | "PLATFORM"
  | "MARKET"
  | "DIVISION"
  | "TEAM"
  | "SINGLE_COACH"
  | "SINGLE_PERSON";

export type Recipient = {
  personId: string;
  name: string;
  /** Primary address (back-compat); may be null. Prefer `emails` for delivery. */
  email: string | null;
  /** Every non-empty address for this person (email + email2 + email3), deduped. */
  emails: string[];
  phone: string | null;
};

/** All non-empty, de-duplicated notification addresses for a person row. */
export function personEmails(p: { email?: string | null; email2?: string | null; email3?: string | null }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [p.email, p.email2, p.email3]) {
    const v = (e ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

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
    select: { id: true, firstName: true, lastName: true, email: true, email2: true, email3: true, phone: true },
  });
  return people.map((p) => ({
    personId: p.id,
    name: `${p.firstName} ${p.lastName}`,
    email: p.email,
    emails: personEmails(p),
    phone: p.phone,
  }));
}

export async function resolveAudience(
  type: AudienceType,
  ref: string | null,
  seasonId: string | null,
  // When false, never expand a minor to their guardian — used for explicit,
  // hand-picked recipient sends so a single message isn't duplicated per person.
  expandOverride?: boolean
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
    case "ALL_ADMINS": {
      const admins = await prisma.user.findMany({
        where: { active: true, personId: { not: null }, role: { in: ADMIN_ROLES as unknown as string[] } },
        select: { personId: true },
      });
      personIds = admins.map((u) => u.personId!).filter(Boolean);
      expandMinors = false;
      break;
    }
    // Whole-platform announcement — the union of the categories named in `ref`
    // (comma-separated: players, parents, coaches, admins). Minor players expand
    // to their guardians as usual; dedupe happens when we fetch the people.
    case "PLATFORM": {
      const cats = new Set((ref ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      const everyone = cats.has("everyone");
      const ids = new Set<string>();
      if (everyone || cats.has("players")) {
        const regs = await prisma.registration.findMany({ where: seasonId ? { seasonId } : {}, select: { personId: true } });
        regs.forEach((r) => ids.add(r.personId));
      }
      if (everyone || cats.has("parents")) {
        const regs = await prisma.registration.findMany({ where: seasonId ? { seasonId } : {}, select: { person: { select: { guardianId: true } } } });
        regs.forEach((r) => { if (r.person.guardianId) ids.add(r.person.guardianId); });
      }
      if (everyone || cats.has("coaches")) {
        const coaches = await prisma.coach.findMany({ select: { personId: true } });
        coaches.forEach((c) => ids.add(c.personId));
      }
      if (everyone || cats.has("admins")) {
        const admins = await prisma.user.findMany({
          where: { active: true, personId: { not: null }, role: { in: ADMIN_ROLES as unknown as string[] } },
          select: { personId: true },
        });
        admins.forEach((u) => { if (u.personId) ids.add(u.personId); });
      }
      personIds = [...ids];
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

  if (expandOverride === false) expandMinors = false;
  if (expandMinors) personIds = await expandGuardians(personIds);
  return toRecipients(personIds);
}
