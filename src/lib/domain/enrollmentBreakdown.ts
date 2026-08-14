// Enrollment breakdown — how the non-canceled registrations split by chosen
// location and by program / skill level, each with an Active vs. Waitlist count.
//
// A signup can list more than one location (locationPrefs is many-to-one), so it
// counts once under EACH distinct location it named — which is why the location
// column can add up to more than the base count. Program is single-value per
// registration, so a signup counts once there.

// Not real, live demand: withdrawn cancellations and the admin dedup states.
const EXCLUDED_STATUS = new Set(["WITHDRAWN", "DUPLICATE", "MERGED"]);
const NO_LOCATION = "No location given";
const NO_PROGRAM = "Unspecified";

export type BreakdownRow = { label: string; active: number; waitlist: number; total: number };
export type EnrollmentBreakdown = {
  base: number;
  byLocation: BreakdownRow[];
  byProgram: BreakdownRow[];
};

export type RegForBreakdown = {
  status: string;
  programInterest: string | null;
  skillLevel: string | null;
  division: { name: string } | null;
  locationPrefs: { marketName: string | null; facility: { name: string; market: string | null } | null }[];
};

/**
 * Aggregate registrations into location and program tallies. Excludes withdrawn
 * and dedup (duplicate/merged) rows so the totals reflect real, live signups.
 */
export function computeEnrollmentBreakdown(regs: RegForBreakdown[]): EnrollmentBreakdown {
  const included = regs.filter((r) => !EXCLUDED_STATUS.has(r.status));

  const locMap = new Map<string, { active: number; waitlist: number }>();
  const progMap = new Map<string, { active: number; waitlist: number }>();
  const bump = (map: typeof locMap, key: string, isWait: boolean) => {
    const e = map.get(key) ?? { active: 0, waitlist: 0 };
    if (isWait) e.waitlist++;
    else e.active++;
    map.set(key, e);
  };

  for (const r of included) {
    const isWait = r.status === "WAITLISTED";

    // Locations — a market-city label per preference, deduped so a signup that
    // named the same city twice isn't double-counted. City preferred (matches
    // the by-location view); fall back to the facility's market, then its name.
    const locs = new Set<string>();
    for (const lp of r.locationPrefs) {
      const label = (lp.marketName ?? lp.facility?.market ?? lp.facility?.name ?? "").trim();
      if (label) locs.add(label);
    }
    if (locs.size === 0) bump(locMap, NO_LOCATION, isWait);
    else for (const l of locs) bump(locMap, l, isWait);

    // Program / skill level — the placed division, else what they asked for.
    const prog = (r.division?.name ?? r.programInterest ?? r.skillLevel ?? "").trim() || NO_PROGRAM;
    bump(progMap, prog, isWait);
  }

  return {
    base: included.length,
    byLocation: toRows(locMap),
    byProgram: toRows(progMap),
  };
}

// Highest total first; ties alphabetical. "No location given" / "Unspecified"
// always sort last so the real buckets lead.
function toRows(map: Map<string, { active: number; waitlist: number }>): BreakdownRow[] {
  return [...map.entries()]
    .map(([label, v]) => ({ label, active: v.active, waitlist: v.waitlist, total: v.active + v.waitlist }))
    .sort((a, b) => {
      const aCatchall = a.label === NO_LOCATION || a.label === NO_PROGRAM;
      const bCatchall = b.label === NO_LOCATION || b.label === NO_PROGRAM;
      if (aCatchall !== bCatchall) return aCatchall ? 1 : -1;
      return b.total - a.total || a.label.localeCompare(b.label);
    });
}
