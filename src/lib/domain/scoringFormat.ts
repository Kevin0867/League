// Composable scoring format for a fixture's games. Every rule and length
// variation an event runs — side-out vs rally, freeze thresholds, games to 11 /
// 15 / 21, single game vs best-of-3 vs best-of-5 — is a combination of these
// knobs, so a round-robin match (one game to 11) and a playoff match (best 2 of
// 3 to 11) differ only by their stored values. This is the single source of
// truth for the score sheet's game count and the human-readable format label.

export type ScoringFormat = {
  /// SIDE_OUT (score only on your serve) | RALLY (every rally scores).
  serveType: string;
  /// Target points for a game (11 / 15 / 21).
  pointsTo: number;
  /// Win-by-2 (a game can't end on a 1-point margin).
  winByTwo: boolean;
  /// Rally-scoring freeze threshold: at/after this score a team can only score
  /// the winning point on its own serve. null = no freeze.
  freezeAt: number | null;
  /// Games needed to win the match: 1 (single game), 2 (best 2 of 3), 3 (best
  /// 3 of 5).
  gamesToWin: number;
};

export const DEFAULT_SCORING: ScoringFormat = {
  serveType: "SIDE_OUT",
  pointsTo: 11,
  winByTwo: true,
  freezeAt: null,
  gamesToWin: 2,
};

/// Named presets covering the common events. Round-robin and playoff are the
/// two the user runs back to back; the rest cover rec and championship play.
export const SCORING_PRESETS: { key: string; label: string; format: ScoringFormat }[] = [
  { key: "rr_11", label: "Round-robin — 1 game to 11, win by 2", format: { serveType: "SIDE_OUT", pointsTo: 11, winByTwo: true, freezeAt: null, gamesToWin: 1 } },
  { key: "bo3_11", label: "Standard — best 2 of 3 to 11, win by 2", format: { serveType: "SIDE_OUT", pointsTo: 11, winByTwo: true, freezeAt: null, gamesToWin: 2 } },
  { key: "rec_15", label: "Rec — 1 game to 15, win by 2", format: { serveType: "SIDE_OUT", pointsTo: 15, winByTwo: true, freezeAt: null, gamesToWin: 1 } },
  { key: "rec_21", label: "Rec — 1 game to 21, win by 2", format: { serveType: "SIDE_OUT", pointsTo: 21, winByTwo: true, freezeAt: null, gamesToWin: 1 } },
  { key: "bo5_11", label: "Championship — best 3 of 5 to 11, win by 2", format: { serveType: "SIDE_OUT", pointsTo: 11, winByTwo: true, freezeAt: null, gamesToWin: 3 } },
  { key: "rally_21_freeze", label: "Rally — 1 game to 21, rally scoring, freeze at 20", format: { serveType: "RALLY", pointsTo: 21, winByTwo: true, freezeAt: 20, gamesToWin: 1 } },
];

export const SERVE_TYPES = [
  { value: "SIDE_OUT", label: "Traditional (side-out) — score on your serve only" },
  { value: "RALLY", label: "Rally scoring — every rally scores" },
];

export const POINTS_TO_OPTIONS = [11, 15, 21];

export const GAMES_TO_WIN_OPTIONS = [
  { value: 1, label: "Single game" },
  { value: 2, label: "Best 2 of 3" },
  { value: 3, label: "Best 3 of 5" },
];

/// Read a scoring format off any object carrying the fixture columns, filling
/// defaults for older rows.
export function scoringFormatOf(f: Partial<ScoringFormat> | null | undefined): ScoringFormat {
  return {
    serveType: f?.serveType ?? DEFAULT_SCORING.serveType,
    pointsTo: f?.pointsTo ?? DEFAULT_SCORING.pointsTo,
    winByTwo: f?.winByTwo ?? DEFAULT_SCORING.winByTwo,
    freezeAt: f?.freezeAt ?? null,
    gamesToWin: f?.gamesToWin ?? DEFAULT_SCORING.gamesToWin,
  };
}

/// Maximum games that can be played under a format (2·gamesToWin − 1).
export function maxGames(fmt: ScoringFormat): number {
  return Math.max(1, 2 * fmt.gamesToWin - 1);
}

/// Compact length label: "1 game to 11" / "best 2 of 3 to 11".
export function lengthLabel(fmt: ScoringFormat): string {
  if (fmt.gamesToWin <= 1) return `1 game to ${fmt.pointsTo}`;
  const total = 2 * fmt.gamesToWin - 1;
  return `best ${fmt.gamesToWin} of ${total} to ${fmt.pointsTo}`;
}

/// Full human-readable format label for headings and badges.
export function describeScoring(fmt: ScoringFormat): string {
  const parts = [lengthLabel(fmt)];
  if (fmt.winByTwo) parts.push("win by 2");
  if (fmt.serveType === "RALLY") parts.push("rally scoring");
  if (fmt.freezeAt != null) parts.push(`freeze at ${fmt.freezeAt}`);
  return parts.join(", ");
}

/// Short badge label: "Bo3 to 11" / "1×11 rally".
export function scoringShort(fmt: ScoringFormat): string {
  const len = fmt.gamesToWin <= 1 ? `1×${fmt.pointsTo}` : `Bo${2 * fmt.gamesToWin - 1} to ${fmt.pointsTo}`;
  return fmt.serveType === "RALLY" ? `${len} rally` : len;
}

/// Parse a scoring format out of submitted form fields.
export function scoringFromForm(get: (k: string) => string | null): ScoringFormat {
  const serveType = (get("serveType") || "SIDE_OUT").trim() === "RALLY" ? "RALLY" : "SIDE_OUT";
  const pointsTo = clampInt(get("pointsTo"), 11, 1, 99);
  const gamesToWin = clampInt(get("gamesToWin"), 2, 1, 3);
  const winByTwo = String(get("winByTwo") ?? "true").trim() !== "false";
  const freezeRaw = (get("freezeAt") || "").trim();
  const freezeAt = serveType === "RALLY" && freezeRaw ? clampInt(freezeRaw, 20, 1, 99) : null;
  return { serveType, pointsTo, winByTwo, freezeAt, gamesToWin };
}

function clampInt(v: string | null, dflt: number, min: number, max: number): number {
  const n = parseInt(String(v ?? "").trim(), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
