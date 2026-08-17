"use client";

import { useMemo, useState } from "react";

export type CoachOption = { id: string; name: string; cleared: boolean; marketMatch: boolean; dayMatch: boolean };
export type MatchTeam = {
  id: string;
  name: string;
  meta: string;
  coachId: string | null;
  options: CoachOption[];
  suggestions: { id: string; name: string }[];
};

// Coach matching used to be one <form> + Save button per team — 19 teams, 19
// saves. Now every dropdown edits a shared dirty set and a single sticky bar
// commits (or discards) the whole batch in one POST.
export function MatchingBoard({ ticket, teams }: { ticket: string; teams: MatchTeam[] }) {
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) m[t.id] = t.coachId ?? "";
    return m;
  }, [teams]);
  const [sel, setSel] = useState<Record<string, string>>(initial);

  const dirty = teams.filter((t) => sel[t.id] !== initial[t.id]);
  const changesJson = JSON.stringify(dirty.map((t) => ({ teamId: t.id, coachId: sel[t.id] })));

  const nameOf = (t: MatchTeam, id: string) => t.options.find((o) => o.id === id)?.name;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => {
          const chosen = sel[team.id];
          const changed = chosen !== initial[team.id];
          return (
            <div key={team.id} className={`card space-y-3 ${changed ? "ring-2 ring-amber-400" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{team.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{team.meta}</div>
                </div>
                {chosen ? (
                  <span className="badge bg-emerald-100 text-emerald-800">{nameOf(team, chosen)}</span>
                ) : (
                  <span className="badge bg-amber-100 text-amber-800">Unassigned</span>
                )}
              </div>

              {team.suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Suggested:</span>
                  {team.suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSel((p) => ({ ...p, [team.id]: s.id }))}
                      className="rounded-full bg-accent-500 px-3 py-1 text-xs font-semibold text-brand-900 hover:bg-accent-400"
                    >
                      + {s.name}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <label className="label text-xs">Assign / move coach{changed ? " · unsaved" : ""}</label>
                <select
                  value={chosen}
                  onChange={(e) => setSel((p) => ({ ...p, [team.id]: e.target.value }))}
                  className="input py-1.5 text-sm"
                >
                  <option value="">— Unassigned —</option>
                  {team.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {!o.cleared ? " ⚠ not cleared" : `${o.marketMatch ? " · ✓location" : ""}${o.dayMatch ? " · ✓day" : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky bulk-save bar — appears only when there are unsaved edits. */}
      {dirty.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-4">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 shadow-lg">
            <span className="text-sm font-medium text-slate-700">
              {dirty.length} unsaved coach change{dirty.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSel(initial)} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                Discard
              </button>
              <form method="POST" action="/api/console/teams">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="assignCoachBulk" />
                <input type="hidden" name="changes" value={changesJson} />
                <button type="submit" className="btn-primary py-1.5 text-sm">
                  Save {dirty.length} change{dirty.length === 1 ? "" : "s"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
