// Coaching-notes catalog + helpers (progress reports). A coach keeps up to six
// one-week notes per student on a team. Each week records preset tags the
// student EXCELLED at and preset tags they can WORK ON, plus a free-text note
// the coach can customize. The same catalog drives both — a skill can be a
// strength one week and a growth area the next.

export const COACHING_WEEKS = [1, 2, 3, 4, 5, 6] as const;
export const COACHING_WEEK_COUNT = COACHING_WEEKS.length;

export type NoteTag = { id: string; label: string };
export type NoteGroup = { title: string; tags: NoteTag[] };

// Grouped so the coach sees pickleball skills and character/class items apart.
export const NOTE_CATALOG: NoteGroup[] = [
  {
    title: "Pickleball skills",
    tags: [
      { id: "serve", label: "Serve" },
      { id: "return", label: "Return of serve" },
      { id: "dinks", label: "Dinking" },
      { id: "third-shot-drop", label: "Third-shot drop" },
      { id: "volleys", label: "Volleys / hands at the net" },
      { id: "resets", label: "Resets" },
      { id: "footwork", label: "Footwork & movement" },
      { id: "positioning", label: "Court positioning" },
      { id: "shot-selection", label: "Shot selection" },
      { id: "consistency", label: "Consistency" },
      { id: "power-control", label: "Power control" },
      { id: "kitchen-discipline", label: "Kitchen (non-volley) discipline" },
      { id: "partner-communication", label: "Communication with partner" },
      { id: "stacking", label: "Stacking / switching" },
      { id: "depth-placement", label: "Depth & placement" },
      { id: "spin-touch", label: "Spin & touch" },
    ],
  },
  {
    title: "Character & class",
    tags: [
      { id: "kind-to-others", label: "Kind to others" },
      { id: "helpful-in-class", label: "Helpful in class" },
      { id: "great-attitude", label: "Great attitude" },
      { id: "coachable", label: "Coachable" },
      { id: "focused", label: "Focused & attentive" },
      { id: "encourages-teammates", label: "Encourages teammates" },
      { id: "punctual", label: "Punctual & prepared" },
      { id: "effort-hustle", label: "Effort & hustle" },
      { id: "sportsmanship", label: "Sportsmanship" },
      { id: "listens", label: "Listens & follows directions" },
      { id: "leadership", label: "Leadership" },
      { id: "resilience", label: "Resilience after mistakes" },
    ],
  },
];

// Flat id → label lookup and the set of valid ids for input sanitization.
export const NOTE_LABELS: Record<string, string> = Object.fromEntries(
  NOTE_CATALOG.flatMap((g) => g.tags.map((t) => [t.id, t.label]))
);
export const NOTE_IDS = new Set(Object.keys(NOTE_LABELS));

export function isValidWeek(week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= COACHING_WEEK_COUNT;
}

/** Parse a stored JSON string-array of tag ids, dropping anything unknown. */
export function parseTags(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map(String).filter((id) => NOTE_IDS.has(id));
  } catch {
    return [];
  }
}

/** Serialize a set of submitted ids to storage, keeping only valid, unique ids. */
export function serializeTags(ids: string[]): string {
  const seen = new Set<string>();
  const clean = ids.filter((id) => NOTE_IDS.has(id) && !seen.has(id) && seen.add(id));
  return JSON.stringify(clean);
}

export function labelFor(id: string): string {
  return NOTE_LABELS[id] ?? id;
}
export function labelsFor(ids: string[]): string[] {
  return ids.map(labelFor);
}

/** True when a week has anything worth sending — a tag or a note. */
export function noteHasContent(n: { strengths?: string | null; growth?: string | null; note?: string | null }): boolean {
  return parseTags(n.strengths).length > 0 || parseTags(n.growth).length > 0 || !!(n.note && n.note.trim());
}
