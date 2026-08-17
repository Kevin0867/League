"use client";

import { useMemo, useState } from "react";

export type Candidate = { id: string; name: string; meta: string };

// Add a registered player onto this team without leaving the team page. Searches
// the season's registered players who aren't already on this roster; each Add is
// a native POST (op=addPlayer). Collapsed by default so the roster stays tidy.
export function AddPlayerToTeam({
  ticket,
  teamId,
  candidates,
  atCap,
}: {
  ticket: string;
  teamId: string;
  candidates: Candidate[];
  atCap: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? candidates.filter((c) => c.name.toLowerCase().includes(s) || c.meta.toLowerCase().includes(s)) : candidates;
    return list.slice(0, 25);
  }, [q, candidates]);

  return (
    <details className="mt-3 rounded-lg border border-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-brand-700">
        + Add players
      </summary>
      <div className="border-t border-slate-100 p-3">
        {atCap && (
          <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
            This team is at capacity — remove a player before adding another.
          </p>
        )}
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500">
            No unassigned registered players for this season. Import or add players in Registrations first.
          </p>
        ) : (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search registered players…"
              className="input mb-2 w-full text-sm"
            />
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {filtered.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-slate-800">{c.name}</span>
                    <span className="ml-2 text-xs text-slate-400">{c.meta}</span>
                  </span>
                  <form method="POST" action="/api/console/teams">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="addPlayer" />
                    <input type="hidden" name="teamId" value={teamId} />
                    <input type="hidden" name="personId" value={c.id} />
                    <button
                      type="submit"
                      disabled={atCap}
                      title={atCap ? "Team is at capacity" : undefined}
                      className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </form>
                </li>
              ))}
              {filtered.length === 0 && <li className="py-2 text-sm text-slate-400">No matches.</li>}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
