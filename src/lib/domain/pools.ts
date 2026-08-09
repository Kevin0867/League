// Pool-and-assignment engine (§4). The custom logic nothing off the shelf does.
//
// A registration carries a SINGLE division, RANKED location preferences, and a
// practice-time preference. A "pool" is every viable combination of
// division × location × time. Because a player ranks several locations, the
// same person appears in several pools — the pools OVERLAP, and the view must
// show overlap rather than let counts be summed.
//
// Assign each person once. Assignment removes them from every other pool and
// re-counts. This module derives pools and overlap; assignment mutations live
// in the server actions.

import { TEAM_MIN } from "../enums";

export type PoolRegistration = {
  registrationId: string;
  personId: string;
  personName: string;
  duprRating: number | null;
  waiverSigned: boolean;
  divisionId: string | null;
  divisionName: string | null;
  timePref: string | null; // weeknight | weekday | weekend | null
  locationPrefs: { facilityId: string; facilityName: string; rank: number }[];
};

export type PoolMember = {
  registrationId: string;
  personId: string;
  personName: string;
  duprRating: number | null;
  waiverSigned: boolean;
  locationRank: number; // this player's ranking of THIS pool's location (1 = top)
  overlapCount: number; // how many pools this player currently sits in
};

export type Pool = {
  key: string;
  divisionId: string | null;
  divisionName: string | null;
  facilityId: string | null;
  facilityName: string | null;
  timePref: string | null;
  members: PoolMember[];
  count: number;
  // Viability per "assign at four; build from two", launch at the minimum (§4).
  viability: "launchable" | "assignable" | "building" | "thin";
};

const TIME_LABEL = "any";

function poolKey(divisionId: string | null, facilityId: string | null, timePref: string | null) {
  return `${divisionId ?? "nodiv"}::${facilityId ?? "noloc"}::${timePref ?? TIME_LABEL}`;
}

function viabilityOf(count: number): Pool["viability"] {
  if (count >= TEAM_MIN) return "launchable"; // >= 6
  if (count >= 4) return "assignable";
  if (count >= 2) return "building";
  return "thin";
}

/**
 * Build overlapping pools from the set of currently-unassigned registrations.
 * Overlap count for each player is the number of distinct pools they land in,
 * so the UI can flag "counted in N pools — assigning here removes the others".
 */
export function buildPools(registrations: PoolRegistration[]): Pool[] {
  // First pass: how many pools does each registration appear in?
  const overlap = new Map<string, number>();
  for (const r of registrations) {
    const locs = r.locationPrefs.length > 0 ? r.locationPrefs : [{ facilityId: "", facilityName: "", rank: 1 }];
    overlap.set(r.registrationId, locs.length);
  }

  // Second pass: bucket registrations into pools.
  const pools = new Map<string, Pool>();
  for (const r of registrations) {
    const locs =
      r.locationPrefs.length > 0
        ? r.locationPrefs
        : [{ facilityId: "", facilityName: "(no location preference)", rank: 1 }];

    for (const loc of locs) {
      const facilityId = loc.facilityId || null;
      const key = poolKey(r.divisionId, facilityId, r.timePref);
      if (!pools.has(key)) {
        pools.set(key, {
          key,
          divisionId: r.divisionId,
          divisionName: r.divisionName,
          facilityId,
          facilityName: loc.facilityName || null,
          timePref: r.timePref,
          members: [],
          count: 0,
          viability: "thin",
        });
      }
      const pool = pools.get(key)!;
      pool.members.push({
        registrationId: r.registrationId,
        personId: r.personId,
        personName: r.personName,
        duprRating: r.duprRating,
        waiverSigned: r.waiverSigned,
        locationRank: loc.rank,
        overlapCount: overlap.get(r.registrationId) ?? 1,
      });
    }
  }

  // Finalize counts, sort members by location rank then rating.
  const result = [...pools.values()].map((p) => {
    p.members.sort((a, b) => a.locationRank - b.locationRank || (b.duprRating ?? 0) - (a.duprRating ?? 0));
    p.count = p.members.length;
    p.viability = viabilityOf(p.count);
    return p;
  });

  // Sort pools: by division, then by descending count (fullest first).
  result.sort(
    (a, b) =>
      (a.divisionName ?? "").localeCompare(b.divisionName ?? "") ||
      b.count - a.count ||
      (a.facilityName ?? "").localeCompare(b.facilityName ?? "")
  );
  return result;
}

export const VIABILITY_LABEL: Record<Pool["viability"], { label: string; tone: string }> = {
  launchable: { label: "launchable", tone: "bg-emerald-100 text-emerald-800" },
  assignable: { label: "assignable", tone: "bg-brand-100 text-brand-800" },
  building: { label: "building", tone: "bg-amber-100 text-amber-800" },
  thin: { label: "thin", tone: "bg-slate-100 text-slate-500" },
};
