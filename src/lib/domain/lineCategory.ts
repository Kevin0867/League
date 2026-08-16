// Categorized club-match lines. A club match is a stack of lines — Men's #1,
// Men's #2, Women's #1, Youth Boys #1, Youth Girls #1, etc. — each a two-player
// pair per side. Categories and rank order live here so the setup UI, the score
// sheet, and any roll-up agree on labels and ordering.

export type LineCategoryKey = "MENS" | "WOMENS" | "MIXED" | "YOUTH_BOYS" | "YOUTH_GIRLS" | "OPEN" | "DREAM_BREAKER";

export const LINE_CATEGORIES: { key: LineCategoryKey; label: string; short: string }[] = [
  { key: "MENS", label: "Men's", short: "M" },
  { key: "WOMENS", label: "Women's", short: "W" },
  { key: "MIXED", label: "Mixed", short: "X" },
  { key: "YOUTH_BOYS", label: "Youth Boys", short: "YB" },
  { key: "YOUTH_GIRLS", label: "Youth Girls", short: "YG" },
  { key: "OPEN", label: "Open", short: "O" },
  { key: "DREAM_BREAKER", label: "Dream Breaker", short: "DB" },
];

/// A Dream Breaker is the MLP singles tiebreaker — only played when the doubles
/// lines end tied. It's a counting line, so an unplayed one (no games) simply
/// doesn't affect the result.
export function isDreamBreaker(category: string | null | undefined): boolean {
  return category === "DREAM_BREAKER";
}

/// Whether the non-Dream-Breaker counting lines are level (so the Dream Breaker
/// decides the match). Fed the fixture's lines with their computed winners.
export function doublesAreTied(
  lines: { category: string; lineWinner: string | null; isCounting: boolean }[],
): boolean {
  let home = 0;
  let away = 0;
  for (const l of lines) {
    if (!l.isCounting || isDreamBreaker(l.category)) continue;
    if (l.lineWinner === "HOME") home++;
    else if (l.lineWinner === "AWAY") away++;
  }
  return home > 0 && home === away;
}

export function categoryLabel(key: string | null | undefined): string {
  return LINE_CATEGORIES.find((c) => c.key === key)?.label ?? "Open";
}

/// Full line label: "Men's #1", or the custom label when set.
export function lineTitle(line: { category: string; rank: number; label?: string | null }): string {
  if (line.label && line.label.trim()) return line.label.trim();
  return `${categoryLabel(line.category)} #${line.rank}`;
}

export type LineTemplateItem = { category: LineCategoryKey; rank: number; label?: string; isCounting?: boolean };

/// One-click line sets. Admins can still add/remove lines after applying one.
export const LINE_TEMPLATES: { key: string; label: string; note: string; lines: LineTemplateItem[] }[] = [
  {
    key: "CLUB_STANDARD",
    label: "Club standard",
    note: "Men's 1–2, Women's 1–2, Youth Boys 1, Youth Girls 1",
    lines: [
      { category: "MENS", rank: 1 },
      { category: "MENS", rank: 2 },
      { category: "WOMENS", rank: 1 },
      { category: "WOMENS", rank: 2 },
      { category: "YOUTH_BOYS", rank: 1 },
      { category: "YOUTH_GIRLS", rank: 1 },
    ],
  },
  {
    key: "MLP",
    label: "MLP style",
    note: "Women's doubles, Men's doubles, two Mixed, + Dream Breaker",
    lines: [
      { category: "WOMENS", rank: 1, label: "Women's doubles" },
      { category: "MENS", rank: 1, label: "Men's doubles" },
      { category: "MIXED", rank: 1, label: "Mixed 1" },
      { category: "MIXED", rank: 2, label: "Mixed 2" },
      { category: "DREAM_BREAKER", rank: 1, label: "Dream Breaker (if 2–2)" },
    ],
  },
  {
    key: "ADULT_3",
    label: "Adult 3 lines",
    note: "Men's 1, Women's 1, Mixed 1",
    lines: [
      { category: "MENS", rank: 1 },
      { category: "WOMENS", rank: 1 },
      { category: "MIXED", rank: 1 },
    ],
  },
];

export function lineTemplate(key: string): LineTemplateItem[] {
  return LINE_TEMPLATES.find((t) => t.key === key)?.lines ?? [];
}
