import "server-only";
import { prisma } from "@/lib/db";
import { ageFromDob, MESSAGING_MIN_AGE } from "@/lib/domain/messaging-acl";
import { DEAD_REG_STATUS } from "@/lib/domain/seasonStats";

export type FamilyInviteCandidate = { personId: string; email: string; firstName: string; role: "PARENT" | "PLAYER" };

/**
 * People in a season's live registrations who should get a portal login but
 * don't have one yet: every guardian with an email, plus every player who has
 * their OWN email and is an adult or at least MESSAGING_MIN_AGE. Under-12s and
 * anyone without their own email are left out — their parent's account covers
 * them. De-duplicated by email (a shared email is claimed as PARENT), and people
 * who already have a login (by email or linked person) are excluded.
 */
export async function familyInviteCandidates(seasonId: string): Promise<FamilyInviteCandidate[]> {
  const regs = await prisma.registration.findMany({
    where: { seasonId, status: { notIn: [...DEAD_REG_STATUS] } },
    select: { personId: true },
  });
  const playerIds = [...new Set(regs.map((r) => r.personId))];
  if (!playerIds.length) return [];
  const players = await prisma.person.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, firstName: true, email: true, dob: true, isMinor: true, guardianId: true },
  });
  const guardianIds = [...new Set(players.map((p) => p.guardianId).filter(Boolean) as string[])];
  const guardians = guardianIds.length
    ? await prisma.person.findMany({ where: { id: { in: guardianIds } }, select: { id: true, firstName: true, email: true } })
    : [];

  const raw: FamilyInviteCandidate[] = [];
  for (const g of guardians) if (g.email) raw.push({ personId: g.id, email: g.email.toLowerCase(), firstName: g.firstName, role: "PARENT" });
  for (const p of players) {
    if (!p.email) continue;
    const age = ageFromDob(p.dob);
    const eligible = !p.isMinor || age === null || age >= MESSAGING_MIN_AGE;
    if (!eligible) continue;
    raw.push({ personId: p.id, email: p.email.toLowerCase(), firstName: p.firstName, role: "PLAYER" });
  }

  // Exclude anyone who already has a login (by email or linked person).
  const existing = await prisma.user.findMany({ select: { email: true, personId: true } });
  const takenEmails = new Set(existing.map((u) => u.email.toLowerCase()));
  const takenPersons = new Set(existing.map((u) => u.personId).filter(Boolean) as string[]);

  const seen = new Set<string>();
  const out: FamilyInviteCandidate[] = [];
  for (const c of raw) {
    if (seen.has(c.email)) continue;
    seen.add(c.email);
    if (takenEmails.has(c.email) || takenPersons.has(c.personId)) continue;
    out.push(c);
  }
  return out;
}
