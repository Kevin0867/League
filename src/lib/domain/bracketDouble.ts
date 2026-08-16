// Double-elimination bracket (§14, event types). A team is only out after two
// losses: the Winners bracket ("W") feeds losers down into the Losers bracket
// ("L"), and the two survivors meet in the Grand Final ("GF"). Byes (for fields
// that aren't a power of two) go to the top seeds and auto-advance.
//
// Structure for size = 2^k teams:
//   • Winners: rounds 1..k, with size/2^r matches in round r.
//   • Losers:  rounds 1..(2k-2). "Pairing" rounds (1,3,5,…) pair Losers
//     survivors; "receiving" rounds (2,4,6,…) pair a Losers survivor against a
//     freshly-dropped Winners loser. Match counts halve every two rounds.
//   • Grand Final: Winners champion vs Losers champion (single match here; a
//     bracket-reset game can be added later).
//
// Everything below is pure so it can be unit-tested without a database. Drops
// map a Winners loser to the same slot index in its target Losers round (a
// simple, valid routing; slot-reversal to further delay rematches is a later
// refinement).

import { seedOrder, nextPowerOfTwo } from "./bracket";

export type BracketKind = "W" | "L" | "GF";

export type DEMatch = {
  bracket: BracketKind;
  round: number;
  slot: number;
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

export type Slot = { bracket: BracketKind; round: number; slot: number; asHome: boolean };

export function winnersRounds(size: number): number {
  return Math.max(1, Math.round(Math.log2(size)));
}

/** Number of Losers-bracket rounds for a size = 2^k field. */
export function losersRounds(size: number): number {
  const k = winnersRounds(size);
  return Math.max(0, 2 * k - 2);
}

/** Matches in Winners round r (1-indexed). */
export function winnersMatchCount(size: number, round: number): number {
  return Math.max(1, size / 2 ** round);
}

/** Matches in Losers round m (1-indexed). */
export function losersMatchCount(size: number, m: number): number {
  // LB1 = size/4; then it halves every two rounds: LB1,LB2 = size/4; LB3,LB4 =
  // size/8; … down to 1,1.
  if (size < 4) return 0;
  const base = size / 4;
  const step = Math.floor((m - 1) / 2); // 0 for m=1,2; 1 for m=3,4; …
  return Math.max(1, base / 2 ** step);
}

/** Where a Winners match winner advances. */
export function winnersWinnerTarget(size: number, round: number, slot: number): Slot {
  const k = winnersRounds(size);
  if (round < k) {
    return { bracket: "W", round: round + 1, slot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
  }
  // Winners champion → Grand Final (home).
  return { bracket: "GF", round: 1, slot: 0, asHome: true };
}

/** Where a Winners match loser drops into the Losers bracket (or the Grand Final
 * when the field is too small to have a Losers bracket). */
export function winnersLoserTarget(size: number, round: number, slot: number): Slot {
  if (losersRounds(size) === 0) {
    // No Losers bracket (size ≤ 2): the Winners final loser goes to the GF.
    return { bracket: "GF", round: 1, slot: 0, asHome: false };
  }
  if (round === 1) {
    // Losers of WR1 seed LB round 1, paired two-per-match.
    return { bracket: "L", round: 1, slot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
  }
  // Losers of WR round r (r>=2) enter the receiving LB round m = 2r-2 on the
  // "away" side; that round has the same match count as WR round r.
  const m = 2 * round - 2;
  return { bracket: "L", round: m, slot, asHome: false };
}

/** Where a Losers match winner advances (null when it wins the LB → Grand Final). */
export function losersWinnerTarget(size: number, m: number): { toGF: boolean; round: number } {
  const last = losersRounds(size);
  if (m >= last) return { toGF: true, round: 0 };
  return { toGF: false, round: m + 1 };
}

/** The slot a Losers-round-m winner takes in the next Losers round. */
export function losersAdvanceSlot(size: number, m: number, slot: number): Slot {
  const nextM = m + 1;
  const nextCount = losersMatchCount(size, nextM);
  const thisCount = losersMatchCount(size, m);
  if (nextCount === thisCount) {
    // Receiving round: LB survivor stays on the home side of the same slot; the
    // freshly-dropped Winners loser fills the away side.
    return { bracket: "L", round: nextM, slot, asHome: true };
  }
  // Pairing round: two survivors combine into one slot.
  return { bracket: "L", round: nextM, slot: Math.floor(slot / 2), asHome: slot % 2 === 0 };
}

/**
 * Structural liveness for a size = 2^k field with n real teams. Returns, for
 * each match key ("W-2-0"…), whether its home and away sides will EVER hold a
 * real team, considering byes only (independent of who wins). A side that can
 * never be filled is "dead" — a match with exactly one live side is a walkover;
 * with none, it's a dead placeholder. Used to auto-advance byes at draw time and
 * to auto-advance a Losers match once its live opponent's drop arrives.
 */
export function computeLiveness(size: number, n: number): Map<string, { home: boolean; away: boolean }> {
  const k = winnersRounds(size);
  const order = seedOrder(size);
  const key = (b: BracketKind, r: number, s: number) => `${b}-${r}-${s}`;

  // Feeder graph: targetKey → { home?: {src, kind}, away?: {src, kind} }.
  type Feed = { src: string; kind: "W" | "L" }; // W = winner output, L = loser output
  const feeders = new Map<string, { home?: Feed; away?: Feed }>();
  const addFeed = (t: Slot, src: string, kind: "W" | "L") => {
    const tk = key(t.bracket, t.round, t.slot);
    const cur = feeders.get(tk) ?? {};
    if (t.asHome) cur.home = { src, kind }; else cur.away = { src, kind };
    feeders.set(tk, cur);
  };
  for (let r = 1; r <= k; r++) {
    for (let s = 0; s < winnersMatchCount(size, r); s++) {
      addFeed(winnersWinnerTarget(size, r, s), key("W", r, s), "W");
      addFeed(winnersLoserTarget(size, r, s), key("W", r, s), "L");
    }
  }
  for (let m = 1; m <= losersRounds(size); m++) {
    for (let s = 0; s < losersMatchCount(size, m); s++) {
      const adv = losersWinnerTarget(size, m);
      if (!adv.toGF) addFeed(losersAdvanceSlot(size, m, s), key("L", m, s), "W");
      else addFeed({ bracket: "GF", round: 1, slot: 0, asHome: false }, key("L", m, s), "W");
    }
  }

  const pw = new Map<string, boolean>(); // produces a winner (≥1 live side)
  const pl = new Map<string, boolean>(); // produces a loser (both sides live)
  const live = new Map<string, { home: boolean; away: boolean }>();
  const sideLive = (f: Feed | undefined): boolean => (f ? (f.kind === "W" ? pw.get(f.src) ?? false : pl.get(f.src) ?? false) : false);

  // Topological order: all W rounds, then all L rounds, then GF.
  const visit = (b: BracketKind, r: number, s: number) => {
    const mk = key(b, r, s);
    let home: boolean, away: boolean;
    if (b === "W" && r === 1) {
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
  for (let r = 1; r <= k; r++) for (let s = 0; s < winnersMatchCount(size, r); s++) visit("W", r, s);
  for (let m = 1; m <= losersRounds(size); m++) for (let s = 0; s < losersMatchCount(size, m); s++) visit("L", m, s);
  visit("GF", 1, 0);
  return live;
}

/** Build every match placeholder for a double-elimination draw, WR round 1 seeded. */
export function buildDoubleElim(seededTeamIds: string[]): {
  size: number;
  matches: DEMatch[];
} {
  const n = seededTeamIds.length;
  const size = nextPowerOfTwo(n);
  const k = winnersRounds(size);
  const teamForSeed = (seed: number): string | null => (seed <= n ? seededTeamIds[seed - 1] : null);
  const matches: DEMatch[] = [];

  // Winners bracket.
  const order = seedOrder(size);
  for (let r = 1; r <= k; r++) {
    const count = winnersMatchCount(size, r);
    for (let s = 0; s < count; s++) {
      if (r === 1) {
        const homeSeed = order[s * 2];
        const awaySeed = order[s * 2 + 1];
        matches.push({
          bracket: "W", round: 1, slot: s,
          homeSeed, awaySeed,
          homeTeamId: teamForSeed(homeSeed), awayTeamId: teamForSeed(awaySeed),
        });
      } else {
        matches.push({ bracket: "W", round: r, slot: s, homeSeed: null, awaySeed: null, homeTeamId: null, awayTeamId: null });
      }
    }
  }

  // Losers bracket.
  const lRounds = losersRounds(size);
  for (let m = 1; m <= lRounds; m++) {
    const count = losersMatchCount(size, m);
    for (let s = 0; s < count; s++) {
      matches.push({ bracket: "L", round: m, slot: s, homeSeed: null, awaySeed: null, homeTeamId: null, awayTeamId: null });
    }
  }

  // Grand Final.
  matches.push({ bracket: "GF", round: 1, slot: 0, homeSeed: null, awaySeed: null, homeTeamId: null, awayTeamId: null });

  return { size, matches };
}
