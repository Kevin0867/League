// Waterfall bracket (§14, event types). Everyone starts in the Gold bracket;
// the losers of each Gold round "waterfall" down into a consolation flight made
// up of players knocked out at the same stage — so a first-round loss still
// means several more matches against similar competition. Each flight is its own
// single-elimination draw.
//
// For a size = 2^k field:
//   • Gold: rounds 1..k, standard single-elimination.
//   • Flight r (r = 1..k-1): the size/2^r losers of Gold round r play a single-
//     elimination bracket. Flight 1 = "Silver", flight 2 = "Bronze", etc.
//   • The Gold final loser is the runner-up (no flight).
//
// Byes (non-power-of-two fields) go to the top Gold seeds; a Gold match that was
// a bye drops no loser, which can leave a flight slot empty — handled as a
// walkover via computeLiveness (same technique as the double-elim engine).

import { seedOrder, nextPowerOfTwo, buildFirstRound } from "./bracket";

export type WFMatch = {
  bracket: string; // "GOLD" | "F1" | "F2" | ...
  round: number;
  slot: number;
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

export type Slot = { bracket: string; round: number; slot: number; asHome: boolean };

export function goldRounds(size: number): number {
  return Math.max(1, Math.round(Math.log2(size)));
}

/** Teams entering flight r = the losers of Gold round r = size/2^r. */
export function flightSize(size: number, r: number): number {
  return Math.max(0, size / 2 ** r);
}

export function flightRounds(size: number, r: number): number {
  const m = flightSize(size, r);
  return m >= 2 ? Math.round(Math.log2(m)) : 0;
}

function matchesInRound(bracketSize: number, round: number): number {
  return Math.max(1, bracketSize / 2 ** round);
}

/** Winner of a Gold match advances in Gold, or wins it all in the final. */
export function goldWinnerTarget(size: number, round: number, slot: number): Slot | null {
  const k = goldRounds(size);
  if (round < k) return { bracket: "GOLD", round: round + 1, slot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
  return null; // Gold champion — overall winner
}

/** Loser of a Gold match drops into flight `round` (null for the final's loser). */
export function goldLoserTarget(size: number, round: number, slot: number): Slot | null {
  const k = goldRounds(size);
  if (round >= k) return null; // final loser = runner-up
  return { bracket: `F${round}`, round: 1, slot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
}

/** Winner of a flight match advances within that flight (or wins the flight). */
export function flightWinnerTarget(size: number, flightR: number, round: number, slot: number): Slot | null {
  const fr = flightRounds(size, flightR);
  if (round < fr) return { bracket: `F${flightR}`, round: round + 1, slot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
  return null; // flight champion
}

/** Build every match placeholder for a waterfall draw, Gold round 1 seeded. */
export function buildWaterfall(seededTeamIds: string[]): { size: number; matches: WFMatch[] } {
  const n = seededTeamIds.length;
  const size = nextPowerOfTwo(n);
  const k = goldRounds(size);
  const matches: WFMatch[] = [];

  // Gold bracket — round 1 seeded from buildFirstRound.
  const first = buildFirstRound(seededTeamIds);
  for (let r = 1; r <= k; r++) {
    const count = matchesInRound(size, r);
    for (let s = 0; s < count; s++) {
      if (r === 1) {
        const fm = first.matches[s];
        matches.push({ bracket: "GOLD", round: 1, slot: s, homeSeed: fm.homeSeed, awaySeed: fm.awaySeed, homeTeamId: fm.homeTeamId, awayTeamId: fm.awayTeamId });
      } else {
        matches.push({ bracket: "GOLD", round: r, slot: s, homeSeed: null, awaySeed: null, homeTeamId: null, awayTeamId: null });
      }
    }
  }

  // Consolation flights.
  for (let r = 1; r <= k - 1; r++) {
    const fr = flightRounds(size, r);
    const fsize = flightSize(size, r);
    for (let round = 1; round <= fr; round++) {
      for (let s = 0; s < matchesInRound(fsize, round); s++) {
        matches.push({ bracket: `F${r}`, round, slot: s, homeSeed: null, awaySeed: null, homeTeamId: null, awayTeamId: null });
      }
    }
  }
  return { size, matches };
}

/**
 * Structural liveness for a size = 2^k field with n real teams. For each match
 * key ("GOLD-1-0", "F1-2-0"…), whether its home/away side will ever hold a real
 * team (byes only). A side that can never fill is dead → a one-live-side match is
 * a walkover; a no-live-side match is a dead placeholder.
 */
export function computeLiveness(size: number, n: number): Map<string, { home: boolean; away: boolean }> {
  const k = goldRounds(size);
  const order = seedOrder(size);
  const key = (b: string, r: number, s: number) => `${b}-${r}-${s}`;

  type Feed = { src: string; kind: "W" | "L" };
  const feeders = new Map<string, { home?: Feed; away?: Feed }>();
  const addFeed = (t: Slot | null, src: string, kind: "W" | "L") => {
    if (!t) return;
    const tk = key(t.bracket, t.round, t.slot);
    const cur = feeders.get(tk) ?? {};
    if (t.asHome) cur.home = { src, kind }; else cur.away = { src, kind };
    feeders.set(tk, cur);
  };
  for (let r = 1; r <= k; r++) {
    for (let s = 0; s < matchesInRound(size, r); s++) {
      addFeed(goldWinnerTarget(size, r, s), key("GOLD", r, s), "W");
      addFeed(goldLoserTarget(size, r, s), key("GOLD", r, s), "L");
    }
  }
  for (let r = 1; r <= k - 1; r++) {
    const fr = flightRounds(size, r);
    const fsize = flightSize(size, r);
    for (let round = 1; round <= fr; round++) {
      for (let s = 0; s < matchesInRound(fsize, round); s++) {
        addFeed(flightWinnerTarget(size, r, round, s), key(`F${r}`, round, s), "W");
      }
    }
  }

  const pw = new Map<string, boolean>();
  const pl = new Map<string, boolean>();
  const live = new Map<string, { home: boolean; away: boolean }>();
  const sideLive = (f: Feed | undefined): boolean => (f ? (f.kind === "W" ? pw.get(f.src) ?? false : pl.get(f.src) ?? false) : false);

  const visit = (b: string, r: number, s: number) => {
    const mk = key(b, r, s);
    let home: boolean, away: boolean;
    if (b === "GOLD" && r === 1) {
      home = order[s * 2] <= n;
      away = order[s * 2 + 1] <= n;
    } else {
      const f = feeders.get(mk) ?? {};
      home = sideLive(f.home);
      away = sideLive(f.away);
    }
    live.set(mk, { home, away });
    pw.set(mk, home || away);
    pl.set(mk, home && away);
  };
  for (let r = 1; r <= k; r++) for (let s = 0; s < matchesInRound(size, r); s++) visit("GOLD", r, s);
  for (let r = 1; r <= k - 1; r++) {
    const fr = flightRounds(size, r);
    const fsize = flightSize(size, r);
    for (let round = 1; round <= fr; round++) for (let s = 0; s < matchesInRound(fsize, round); s++) visit(`F${r}`, round, s);
  }
  return live;
}
