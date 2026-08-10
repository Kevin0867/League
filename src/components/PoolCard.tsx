"use client";

import { useState } from "react";
import { VIABILITY_LABEL, type Pool } from "@/lib/domain/pools";

type TeamOption = { id: string; name: string; divisionId: string | null; remaining: number };

export function PoolCard({
  pool,
  seasonId,
  teams,
  ticket,
}: {
  pool: Pool;
  seasonId: string;
  teams: TeamOption[];
  ticket: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamName, setTeamName] = useState(
    `${pool.divisionName ?? "Team"} — ${pool.facilityName ?? "TBD"}`.slice(0, 60)
  );
  const [teamId, setTeamId] = useState("");
  const v = VIABILITY_LABEL[pool.viability];

  // Existing teams in this pool's division are valid assignment targets.
  const targets = teams.filter((t) => t.divisionId === pool.divisionId);
  const noSelection = selected.size === 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Native POST to /api/console/pools carrying the ticket. Checkboxes named
  // "reg" ride along in the body; the two submit buttons distinguish op.
  return (
    <form method="POST" action="/api/console/pools" className="card !p-3">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="divisionId" value={pool.divisionId ?? ""} />
      <input type="hidden" name="facilityId" value={pool.facilityId ?? ""} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">{pool.facilityName ?? "No location preference"}</h3>
          <p className="truncate text-[11px] text-slate-400">
            {pool.divisionName ?? "Unplaced division"}
            {pool.timePref ? ` · ${pool.timePref}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`badge ${v.tone}`}>{v.label}</span>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-700">{pool.count}</span>
        </div>
      </div>

      {/* Compact, board-style player tiles */}
      <div className="mt-2 space-y-1">
        {pool.members.map((m) => {
          const on = selected.has(m.registrationId);
          return (
            <label
              key={m.registrationId}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-sm shadow-sm ${
                on ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="checkbox"
                name="reg"
                value={m.registrationId}
                className="h-3.5 w-3.5 shrink-0"
                checked={on}
                onChange={() => toggle(m.registrationId)}
                aria-label={`Select ${m.personName}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-slate-800">{m.personName}</span>
                  {!m.waiverSigned && <span title="Waiver outstanding" className="shrink-0 text-xs text-amber-500">⚠</span>}
                  {m.overlapCount > 1 && (
                    <span className="shrink-0 text-[10px] text-brand-600" title="Assigning here removes them from other pools">
                      ×{m.overlapCount}
                    </span>
                  )}
                </span>
                <span className="block text-[10px] leading-tight text-slate-400">
                  {m.duprRating ? `DUPR ${m.duprRating}` : "no rating"}
                  {m.locationRank > 1 ? ` · #${m.locationRank} choice` : ""}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{selected.size} selected</span>
          <button type="button" className="text-brand-600 hover:underline"
            onClick={() => setSelected(new Set(pool.members.map((m) => m.registrationId)))}>
            select all
          </button>
        </div>

        {/* Form a new team from the selection */}
        <div className="flex gap-2">
          <input
            className="input text-sm"
            name="name"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="New team name"
          />
          <button
            type="submit"
            name="op"
            value="create"
            disabled={noSelection}
            className="btn-primary whitespace-nowrap text-sm"
          >
            Form team
          </button>
        </div>

        {/* Assign to an existing team in this division */}
        {targets.length > 0 && (
          <div className="flex gap-2">
            <select
              className="input text-sm"
              name="teamId"
              value={teamId || targets[0]?.id || ""}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.remaining} left)</option>
              ))}
            </select>
            <button
              type="submit"
              name="op"
              value="assign"
              disabled={noSelection}
              className="btn-secondary whitespace-nowrap text-sm"
            >
              Add to team
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
