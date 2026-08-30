"use client";

import { useMemo, useState } from "react";
import { TEAM_CAP, TEAM_MAX } from "@/lib/enums";

export type Candidate = { id: string; name: string; meta: string };

// Add a registered player onto this team without leaving the team page. Searches
// the season's registered players who aren't already on this roster; each Add is
// a native POST (op=addPlayer). Collapsed by default so the roster stays tidy.
// `atCap` here means at the admin MAX (10) — a hard stop; `overCap` means over
// the target (8) but still addable up to the max, so staff can add-then-move.
export function AddPlayerToTeam({
  ticket,
  teamId,
  candidates,
  atCap,
  overCap = false,
}: {
  ticket: string;
  teamId: string;
  candidates: Candidate[];
  atCap: boolean;
  overCap?: boolean;
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
        {atCap ? (
          <p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">
            This team is at the maximum of {TEAM_MAX} — remove a player before adding another.
          </p>
        ) : overCap ? (
          <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
            Over the target of {TEAM_CAP}. You can add up to {TEAM_MAX} to shuffle rosters — then move a player to get back to {TEAM_CAP}.
          </p>
        ) : null}
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
                      title={atCap ? `Team is at the maximum of ${TEAM_MAX}` : undefined}
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
