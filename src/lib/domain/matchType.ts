// League match formats (§12). A fixture's matchType decides how many lines the
// score sheet renders and which lines count toward the standings. Keep this the
// single source of truth so the score form, the standings engine input, and the
// hub badges never disagree.

export type MatchTypeKey = "TEAM_3" | "TEAM_5" | "SINGLE_LINE";

export type MatchTypeConfig = {
  key: MatchTypeKey;
  /// Full descriptive label (menus, headings).
  label: string;
  /// Compact badge label (tables, chips).
  short: string;
  /// One-line explainer for the schedule form.
  hint: string;
  /// Total lines rendered on the score sheet.
  lines: number;
  /// A line that is played and recorded but does NOT count toward the result,
  /// or null when every line counts.
  exhibitionLine: number | null;
};

export const MATCH_TYPES: MatchTypeConfig[] = [
  {
    key: "TEAM_3",
    label: "Team match — 3 lines + exhibition",
    short: "3 lines + exh",
    hint: "Lines 1–3 decide the match; line 4 is a recorded, non-counting exhibition.",
    lines: 4,
    exhibitionLine: 4,
  },
  {
    key: "TEAM_5",
    label: "Team match — 5 lines",
    short: "5 lines",
    hint: "Five counting lines — best-of-line wins take the match.",
    lines: 5,
    exhibitionLine: null,
  },
  {
    key: "SINGLE_LINE",
    label: "Single line",
    short: "1 line",
    hint: "A single head-to-head line — one result decides it.",
    lines: 1,
    exhibitionLine: null,
  },
];

export function matchTypeConfig(key: string | null | undefined): MatchTypeConfig {
  return MATCH_TYPES.find((m) => m.key === key) ?? MATCH_TYPES[0];
}

export function matchTypeLabel(key: string | null | undefined): string {
  return matchTypeConfig(key).label;
}

export function matchTypeShort(key: string | null | undefined): string {
  return matchTypeConfig(key).short;
}

/// Label for a single line under a given format (Line N, or "Exhibition").
export function lineLabel(line: number, cfg: MatchTypeConfig): string {
  return cfg.exhibitionLine === line ? "Exhibition" : `Line ${line}`;
}

/// Whether a line counts toward the standings under a given format.
export function isCountingLine(line: number, cfg: MatchTypeConfig): boolean {
  return cfg.exhibitionLine !== line;
}
