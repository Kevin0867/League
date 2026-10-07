// Bracket grouping for ACP league play: teams compete only within their own
// gender + skill level. The team's divisionCode already encodes this —
//   adults  → W3.0 / M3.5 / W5.0+ …  (gender prefix + DUPR band)
//   youth   → ELE / MID / HS         (school level)
// so a team's division CODE is its bracket key: all W3.0 teams play each other,
// all M3.5 play each other, HS plays HS, etc. Teams without a code (e.g. a brand
// new outside club not yet classified) fall into an "Unassigned" group that's
// flagged in the console rather than mixed into real brackets.

import { deriveDivisionCode } from "@/lib/domain/teamName";

export const UNASSIGNED = "UNASSIGNED";

export type BracketTeamLike = {
  divisionCode?: string | null;
  gender?: string | null;
  levelBand?: string | null;
  division?: { name: string | null } | null;
};

/** The bracket group key for a team — its division code, or UNASSIGNED. */
export function bracketKeyForTeam(t: BracketTeamLike): string {
  const code = (t.divisionCode ?? "").trim().toUpperCase();
  if (code) return code;
  // Fall back to deriving a code from the division name / gender + band.
  const derived = deriveDivisionCode(t.division?.name ?? null, t.levelBand ?? null);
  if (derived) return derived.toUpperCase();
  return UNASSIGNED;
}

/** A readable label for a bracket group code (e.g. "Women's 3.0", "High School"). */
export function bracketLabel(code: string): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!c || c === UNASSIGNED) return "Unassigned";
  if (c === "ELE") return "Elementary";
  if (c === "MID") return "Middle School";
  if (c === "HS") return "High School";
  const m = /^([WM])(\d\.\d\+?)$/.exec(c);
  if (m) return `${m[1] === "W" ? "Women's" : "Men's"} ${m[2]}`;
  return code; // unknown shape — show as-is
}

/** Sort key so groups list in a sensible order: Men's bands (asc), Women's bands
 *  (asc), youth (ELE→MID→HS), then Unassigned last. */
export function bracketSortKey(code: string): [number, number, string] {
  const c = (code ?? "").trim().toUpperCase();
  if (c === UNASSIGNED || !c) return [9, 0, ""];
  const youth = { ELE: 0, MID: 1, HS: 2 } as Record<string, number>;
  if (c in youth) return [2, youth[c], c];
  const m = /^([WM])(\d\.\d)/.exec(c);
  if (m) {
    const seg = m[1] === "M" ? 0 : 1;
    return [seg, parseFloat(m[2]) || 0, c];
  }
  return [8, 0, c];
}

export type BracketGroup<T> = { key: string; label: string; teams: T[] };

/** Partition teams into bracket groups (gender + level), ordered for display. */
export function groupTeamsIntoBrackets<T extends BracketTeamLike>(teams: T[]): BracketGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const t of teams) {
    const key = bracketKeyForTeam(t);
    (by.get(key) ?? by.set(key, []).get(key)!).push(t);
  }
  return [...by.entries()]
    .map(([key, ts]) => ({ key, label: bracketLabel(key), teams: ts }))
    .sort((a, b) => {
      const ka = bracketSortKey(a.key), kb = bracketSortKey(b.key);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    });
}
