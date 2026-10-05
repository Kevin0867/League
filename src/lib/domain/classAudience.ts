import "server-only";
import { prisma } from "@/lib/db";

// Audience targeting for a publicly-listed class/clinic. A class carries optional
// target dimensions (DUPR band, gender, age group); this resolves the people who
// match, so an admin can invite exactly "the 4.5 men" (or 3.0–3.5 women, or youth
// beginners) through the portal, email, text, or a Zoho campaign.

export type ClassTarget = {
  targetMinRating?: number | null;
  targetMaxRating?: number | null;
  targetGender?: string | null;   // MALE | FEMALE | null
  targetAgeGroup?: string | null; // YOUTH | ADULT | null
};

export type MatchedPerson = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  duprRating: number | null;
  gender: string | null;
  age: number | null;
};

export function hasAnyTarget(t: ClassTarget): boolean {
  return t.targetMinRating != null || t.targetMaxRating != null || !!t.targetGender || !!t.targetAgeGroup;
}

/** Whole years old today, or null if no DOB on file. */
export function ageFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

/** A human-readable "who this is for" line from the target dimensions. */
export function describeTarget(t: ClassTarget): string {
  const parts: string[] = [];
  if (t.targetMinRating != null || t.targetMaxRating != null) {
    if (t.targetMinRating != null && t.targetMaxRating != null) parts.push(`${t.targetMinRating.toFixed(1)}–${t.targetMaxRating.toFixed(1)} DUPR`);
    else if (t.targetMinRating != null) parts.push(`${t.targetMinRating.toFixed(1)}+ DUPR`);
    else parts.push(`up to ${t.targetMaxRating!.toFixed(1)} DUPR`);
  }
  if (t.targetGender === "MALE") parts.push("men");
  else if (t.targetGender === "FEMALE") parts.push("women");
  if (t.targetAgeGroup === "YOUTH") parts.push("youth (under 18)");
  else if (t.targetAgeGroup === "ADULT") parts.push("adults (18+)");
  return parts.length ? parts.join(" · ") : "open to everyone";
}

/** People matching a class's target. Empty if no dimension is set (don't blast
 *  the whole directory by accident — the UI asks the admin to set a target). */
export async function matchTargetAudience(t: ClassTarget): Promise<MatchedPerson[]> {
  if (!hasAnyTarget(t)) return [];

  // Narrow at the DB level where we can; finish age filtering in JS (needs DOB math).
  const where: Record<string, unknown> = {};
  if (t.targetMinRating != null || t.targetMaxRating != null) {
    where.duprRating = {
      not: null,
      ...(t.targetMinRating != null ? { gte: t.targetMinRating } : {}),
      ...(t.targetMaxRating != null ? { lte: t.targetMaxRating } : {}),
    };
  }
  if (t.targetGender === "MALE" || t.targetGender === "FEMALE") where.gender = t.targetGender;
  if (t.targetAgeGroup === "YOUTH" || t.targetAgeGroup === "ADULT") where.dob = { not: null };

  const people = await prisma.person.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, duprRating: true, gender: true, dob: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 2000,
  });

  const out: MatchedPerson[] = [];
  for (const p of people) {
    const age = ageFromDob(p.dob);
    if (t.targetAgeGroup === "YOUTH" && !(age != null && age < 18)) continue;
    if (t.targetAgeGroup === "ADULT" && !(age != null && age >= 18)) continue;
    out.push({
      id: p.id, name: `${p.firstName} ${p.lastName}`.trim(),
      email: p.email, phone: p.phone, duprRating: p.duprRating, gender: p.gender, age,
    });
  }
  return out;
}
