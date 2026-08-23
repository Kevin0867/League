"use client";

import { useState } from "react";

type Opt = { id: string; name: string };

// Scope picker for a package or a deal: a scopeType select plus a dependent
// target select (a season for LEAGUE/TOURNAMENT, a team for TEAM, nothing for
// ORG). Emits the two fields the route reads: scopeType + scopeId.
export function ScopePicker({
  seasons,
  teams,
  defaultType = "LEAGUE",
  defaultScopeId = "",
}: {
  seasons: Opt[];
  teams: Opt[];
  defaultType?: string;
  defaultScopeId?: string;
}) {
  const [type, setType] = useState(defaultType);
  const needsSeason = type === "LEAGUE" || type === "TOURNAMENT";
  const needsTeam = type === "TEAM";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block">
        <span className="label">Level</span>
        <select name="scopeType" value={type} onChange={(e) => setType(e.target.value)} className="input">
          <option value="LEAGUE">League</option>
          <option value="TOURNAMENT">Tournament</option>
          <option value="TEAM">Team</option>
          <option value="ORG">Whole organization</option>
        </select>
      </label>
      <label className="block">
        <span className="label">{needsTeam ? "Team" : needsSeason ? "Season" : "Applies to"}</span>
        {needsSeason ? (
          <select name="scopeId" defaultValue={defaultScopeId} className="input">
            <option value="">— select a season —</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : needsTeam ? (
          <select name="scopeId" defaultValue={defaultScopeId} className="input">
            <option value="">— select a team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        ) : (
          <input className="input" value="Entire organization" disabled />
        )}
      </label>
    </div>
  );
}
