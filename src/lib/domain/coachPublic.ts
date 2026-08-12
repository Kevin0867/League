// Public coach-profile field visibility (build: coaches directory + privacy).
// A coach/admin chooses which fields the public sees; `publicHidden` stores the
// keys they've turned OFF. Name and photo are always public once published.

export const COACH_PUBLIC_FIELDS = [
  { key: "bio", label: "Bio" },
  { key: "credentials", label: "Certifications & credentials" },
  { key: "markets", label: "Locations / markets" },
  { key: "levels", label: "Levels & ages coached" },
] as const;

export type CoachPublicFieldKey = (typeof COACH_PUBLIC_FIELDS)[number]["key"];

/** True if a field should be shown publicly (i.e. not in the hidden list). */
export function isPublic(publicHidden: string[] | null | undefined, key: CoachPublicFieldKey): boolean {
  return !(publicHidden ?? []).includes(key);
}

export function parseMarketsJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
