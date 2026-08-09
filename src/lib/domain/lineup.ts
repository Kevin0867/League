// Line-up validation (§14). PURE Academy teams rank by team rank, set by the
// coach on playing strength. Non-PURE (outside) teams MUST rank by combined
// DUPR — line 1 higher than line 2, line 2 higher than line 3 — and the system
// validates this on submission and rejects a non-compliant line-up. In a
// recorded league, holding a strong pair at line 3 distorts opponents' ratings.

export type LineupPair = {
  lineNumber: number; // 1..4 (4 = exhibition, non-counting)
  playerAId: string;
  playerBId: string;
  combinedDupr: number;
};

export function validateLineup(
  pairs: LineupPair[],
  teamOrigin: string
): { ok: true } | { ok: false; error: string } {
  const counting = pairs
    .filter((p) => p.lineNumber >= 1 && p.lineNumber <= 3)
    .sort((a, b) => a.lineNumber - b.lineNumber);

  if (counting.length < 3) {
    return { ok: false, error: "A line-up needs lines 1, 2, and 3." };
  }

  // Outside teams must be ordered by descending combined DUPR.
  if (teamOrigin !== "PURE_ACADEMY") {
    for (let i = 0; i < counting.length - 1; i++) {
      if (counting[i].combinedDupr < counting[i + 1].combinedDupr) {
        return {
          ok: false,
          error: `Non-compliant line-up: line ${counting[i].lineNumber} (combined DUPR ${counting[i].combinedDupr.toFixed(1)}) must be ranked at or above line ${counting[i + 1].lineNumber} (${counting[i + 1].combinedDupr.toFixed(1)}). Outside teams rank by combined DUPR.`,
        };
      }
    }
  }
  return { ok: true };
}
