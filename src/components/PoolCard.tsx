"use client";

import { useState } from "react";
import { assignToTeam, createTeamFromPool } from "@/app/console/pools/actions";
import { VIABILITY_LABEL, type Pool } from "@/lib/domain/pools";

type TeamOption = { id: string; name: string; divisionId: string | null; remaining: number };

export function PoolCard({
  pool,
  seasonId,
  teams,
}: {
  pool: Pool;
  seasonId: string;
  teams: TeamOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const v = VIABILITY_LABEL[pool.viability];

  // Existing teams in this pool's division are valid assignment targets.
  const targets = teams.filter((t) => t.divisionId === pool.divisionId);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const suggestedName = `${pool.divisionName ?? "Team"} — ${pool.facilityName ?? "TBD"}`.slice(0, 60);

  async function run(action: (fd: FormData) => Promise<void>, extra: Record<string, string>) {
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one player.");
      return;
    }
    const fd = new FormData();
    for (const id of selected) fd.append("reg", id);
    fd.set("seasonId", seasonId);
    fd.set("divisionId", pool.divisionId ?? "");
    fd.set("facilityId", pool.facilityId ?? "");
    for (const [k, val] of Object.entries(extra)) fd.set(k, val);
    try {
      await action(fd);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed.");
    }
  }

  return (
    <div className="card">
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

      {error && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{selected.size} selected</span>
          <button type="button" className="text-brand-600 hover:underline"
            onClick={() => setSelected(new Set(pool.members.map((m) => m.registrationId)))}>
            select all
          </button>
        </div>

        {/* Form a new team from the selection */}
        <NewTeamForm
          defaultName={suggestedName}
          disabled={selected.size === 0}
          onSubmit={(name) => run(createTeamFromPool, { name })}
        />

        {/* Assign to an existing team in this division */}
        {targets.length > 0 && (
          <AssignForm
            teams={targets}
            disabled={selected.size === 0}
            onSubmit={(teamId) => run(assignToTeam, { teamId })}
          />
        )}
      </div>
    </div>
  );
}

function NewTeamForm({ defaultName, disabled, onSubmit }: { defaultName: string; disabled: boolean; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  return (
    <div className="flex gap-2">
      <input className="input text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name" />
      <button type="button" disabled={disabled} className="btn-primary whitespace-nowrap text-sm" onClick={() => onSubmit(name)}>
        Form team
      </button>
    </div>
  );
}

function AssignForm({ teams, disabled, onSubmit }: { teams: TeamOption[]; disabled: boolean; onSubmit: (teamId: string) => void }) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  return (
    <div className="flex gap-2">
      <select className="input text-sm" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.name} ({t.remaining} left)</option>
        ))}
      </select>
      <button type="button" disabled={disabled || !teamId} className="btn-secondary whitespace-nowrap text-sm" onClick={() => onSubmit(teamId)}>
        Add to team
      </button>
    </div>
  );
}
