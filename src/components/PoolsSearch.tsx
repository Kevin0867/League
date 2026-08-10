"use client";

import { useState } from "react";
import { PoolCard } from "./PoolCard";
import type { Pool } from "@/lib/domain/pools";

type TeamOption = { id: string; name: string; divisionId: string | null; remaining: number };

// Instant client-side search over the assignment pools — matches a pool by its
// division, location, or time, or by any player's name in it (same behavior as
// the Boards search).
export function PoolsSearch({
  pools,
  teams,
  seasonId,
  ticket,
}: {
  pools: Pool[];
  teams: TeamOption[];
  seasonId: string;
  ticket: string;
}) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();

  const matches = (p: Pool) => {
    if (!s) return true;
    const hay = [p.divisionName, p.facilityName, p.timePref, ...p.members.map((m) => m.personName)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(s);
  };
  const filtered = pools.filter(matches);

  // Group by division for display.
  const byDivision = new Map<string, Pool[]>();
  for (const p of filtered) {
    const key = p.divisionName ?? "Unplaced";
    if (!byDivision.has(key)) byDivision.set(key, []);
    byDivision.get(key)!.push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by player, division, location, or time…"
          className="input max-w-md"
          aria-label="Search assignment pools"
        />
        {s && (
          <span className="text-sm text-slate-500">
            {filtered.length} pool{filtered.length === 1 ? "" : "s"} match
            <button type="button" onClick={() => setQ("")} className="ml-2 text-brand-600 hover:underline">clear</button>
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-sm text-slate-500">No pools match “{q}”.</div>
      ) : (
        [...byDivision.entries()].map(([division, dpools]) => (
          <section key={division}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{division}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {dpools.map((pool) => (
                <PoolCard key={pool.key} pool={pool} seasonId={seasonId} teams={teams} ticket={ticket} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
