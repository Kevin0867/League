// Duplicate detection (§3): "The August file produced 86 registrations from 74
// people. Match on name plus email or phone and merge, placing the person at
// the highest band registered while preserving all location and time
// preferences."

export type PersonKeyFields = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
};

function norm(s?: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

function normPhone(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Two people are likely the same when names match AND (email OR phone) match. */
export function isLikelyDuplicate(a: PersonKeyFields, b: PersonKeyFields): boolean {
  if (a.id === b.id) return false;
  const sameName =
    norm(a.firstName) === norm(b.firstName) && norm(a.lastName) === norm(b.lastName);
  if (!sameName) return false;
  const sameEmail = norm(a.email) !== "" && norm(a.email) === norm(b.email);
  const samePhone =
    normPhone(a.phone) !== "" && normPhone(a.phone) === normPhone(b.phone);
  return sameEmail || samePhone;
}

/** Group registrations that appear to belong to the same human. */
export function findDuplicateGroups(people: PersonKeyFields[]): PersonKeyFields[][] {
  const seen = new Set<string>();
  const groups: PersonKeyFields[][] = [];
  for (let i = 0; i < people.length; i++) {
    if (seen.has(people[i].id)) continue;
    const group = [people[i]];
    for (let j = i + 1; j < people.length; j++) {
      if (seen.has(people[j].id)) continue;
      if (isLikelyDuplicate(people[i], people[j])) {
        group.push(people[j]);
        seen.add(people[j].id);
      }
    }
    if (group.length > 1) {
      seen.add(people[i].id);
      groups.push(group);
    }
  }
  return groups;
}
