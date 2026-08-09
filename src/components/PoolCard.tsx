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
    <form method="POST" action="/api/console/pools" className="card">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="divisionId" value={pool.divisionId ?? ""} />
      <input type="hidden" name="facilityId" value={pool.facilityId ?? ""} />

      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">{pool.facilityName ?? "No location preference"}</h3>
          <p className="text-xs text-slate-400">
            {pool.divisionName ?? "Unplaced division"}
            {pool.timePref ? ` · ${pool.timePref}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${v.tone}`}>{v.label}</span>
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-sm font-bold text-slate-700">{pool.count}</span>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-slate-100">
        {pool.members.map((m) => (
          <li key={m.registrationId} className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              name="reg"
              value={m.registrationId}
              className="h-4 w-4"
              checked={selected.has(m.registrationId)}
              onChange={() => toggle(m.registrationId)}
              aria-label={`Select ${m.personName}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-800">{m.personName}</span>
                {m.locationRank > 1 && (
                  <span className="text-[10px] text-slate-400">#{m.locationRank} choice</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>{m.duprRating ? `DUPR ${m.duprRating}` : "no rating"}</span>
                {!m.waiverSigned && <span className="text-amber-600">⚠ no waiver</span>}
                {m.overlapCount > 1 && (
                  <span className="text-brand-600" title="Assigning here removes them from other pools">
                    in {m.overlapCount} pools
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
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
