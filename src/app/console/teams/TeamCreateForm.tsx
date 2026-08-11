"use client";

import { useState } from "react";

export type SeasonOpt = { id: string; name: string; program?: string; divisions: { id: string; name: string }[] };
type FacilityOpt = { id: string; name: string };

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function TeamCreateForm({
  ticket,
  seasons,
  facilities,
}: {
  ticket: string;
  seasons: SeasonOpt[];
  facilities: FacilityOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">+ Create team</button>
    );
  }

  const divisions = seasons.find((s) => s.id === seasonId)?.divisions ?? [];

  return (
    <form method="POST" action="/api/console/teams" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="createTeam" />
      <h3 className="font-semibold text-brand-900">Create team</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Team name</label>
          <input name="name" className="input" placeholder="Scottsdale Women's 3.5 — Tue" required />
        </div>
        <div>
          <label className="label">Season</label>
          <select name="seasonId" value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className="input" required>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Division</label>
          <select name="divisionId" className="input">
            <option value="">— none —</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Facility (optional)</label>
          <select name="facilityId" className="input">
            <option value="">— none —</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Practice day (optional)</label>
          <select name="dayOfWeek" className="input">
            <option value="">—</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Start time (optional)</label>
          <input name="startTime" type="time" className="input" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Create team</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}
