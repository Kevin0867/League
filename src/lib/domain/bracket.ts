// Single-elimination championship bracket (§14). Teams are seeded from division
// standings; the draw uses standard bracket seeding (1 plays the lowest seed,
// 2 the next-lowest, …) so higher seeds meet later. Sizes that aren't a power of
// two get byes for the top seeds, which auto-advance.

/**
 * Standard seeding order for a bracket of `size` (a power of two). Returns the
 * seed numbers in bracket position order; consecutive pairs are first-round
 * matchups. e.g. size 8 → [1,8,4,5,2,7,3,6].
 */
export function seedOrder(size: number): number[] {
  let pls = [1, 2];
  while (pls.length < size) {
    const n = pls.length * 2 + 1;
    const out: number[] = [];
    for (const p of pls) {
      out.push(p);
      out.push(n - p);
    }
    pls = out;
  }
  return pls;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(1, p);
}

export function totalRounds(size: number): number {
  return Math.max(1, Math.round(Math.log2(size)));
}

export type FirstRoundMatch = {
  slot: number;
  homeSeed: number;
  awaySeed: number;
  homeTeamId: string | null; // null when the seed exceeds the field (a bye)
  awayTeamId: string | null;
};

/**
 * Build the first-round matches for a list of teams already ordered by seed
 * (index 0 = seed 1). A seed beyond the field size is a bye (null team).
 */
export function buildFirstRound(seededTeamIds: string[]): {
  size: number;
  rounds: number;
  matches: FirstRoundMatch[];
} {
  const n = seededTeamIds.length;
  const size = nextPowerOfTwo(n);
  const order = seedOrder(size);
  const teamForSeed = (seed: number): string | null => (seed <= n ? seededTeamIds[seed - 1] : null);

  const matches: FirstRoundMatch[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const homeSeed = order[i];
    const awaySeed = order[i + 1];
    matches.push({
      slot: i / 2,
      homeSeed,
      awaySeed,
      homeTeamId: teamForSeed(homeSeed),
      awayTeamId: teamForSeed(awaySeed),
    });
  }
  return { size, rounds: totalRounds(size), matches };
}

/** Where a match's winner advances to in the next round. */
export function advanceTarget(slot: number): { nextSlot: number; asHome: boolean } {
  return { nextSlot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
}
