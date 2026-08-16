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

/** Levenshtein edit distance — small helper for first-name variants. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[n];
}

/** First names that are the same, a nickname/prefix, or one small edit apart —
 *  so "Dave"/"David", "DeeDee"/"Dee Dee", "Katie"/"Kate" surface as candidates. */
function similarFirstName(a: string, b: string): boolean {
  const x = norm(a).replace(/\s+/g, "");
  const y = norm(b).replace(/\s+/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  const d = editDistance(x, y);
  return d <= 2 && d < Math.min(x.length, y.length);
}

/**
 * Likely the same person when the last name matches, a contact point (email or
 * phone) matches, AND the first name is the same or a close variant. Requiring
 * a shared contact keeps siblings who share an email (different first name, no
 * variant relationship) from being flagged as the same human. These are only
 * SURFACED for review — the merge itself is an explicit admin action.
 */
export function isLikelyDuplicate(a: PersonKeyFields, b: PersonKeyFields): boolean {
  if (a.id === b.id) return false;
  if (norm(a.lastName) !== norm(b.lastName)) return false;
  const sameEmail = norm(a.email) !== "" && norm(a.email) === norm(b.email);
  const samePhone = normPhone(a.phone) !== "" && normPhone(a.phone) === normPhone(b.phone);
  if (!sameEmail && !samePhone) return false;
  return similarFirstName(a.firstName, b.firstName);
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
