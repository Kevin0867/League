"use client";

import { useState } from "react";
import type { SeasonOpt } from "@/app/console/teams/TeamCreateForm";

export function AddPlayerForm({ ticket, seasons, defaultSeasonId }: { ticket: string; seasons: SeasonOpt[]; defaultSeasonId?: string }) {
  const [open, setOpen] = useState(false);
  const [seasonId, setSeasonId] = useState(defaultSeasonId || seasons[0]?.id || "");

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-primary">+ Add player</button>;
  }

  const divisions = seasons.find((s) => s.id === seasonId)?.divisions ?? [];

  return (
    <form method="POST" action="/api/console/registrations" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="addPlayer" />
      <h3 className="font-semibold text-brand-900">Add a player</h3>
      <p className="text-xs text-slate-500">
        Creates the player and a registration in the chosen season — they appear in the
        roster and assignment pools. Matched and merged if they already exist.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">First name</label>
          <input name="firstName" className="input" required />
        </div>
        <div>
          <label className="label">Last name</label>
          <input name="lastName" className="input" required />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" className="input" placeholder="one of email or phone" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input name="phone" className="input" placeholder="one of email or phone" />
        </div>
        <div>
          <label className="label">Date of birth (optional)</label>
          <input name="dob" type="date" className="input" />
        </div>
        <div>
          <label className="label">Season</label>
          <select name="seasonId" value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className="input" required>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.program === "ACP" ? " · ACP league" : s.program === "PURE_ACADEMY" ? " · PURE Academy" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Division</label>
          <select name="divisionId" className="input">
            <option value="">— unassigned —</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Add player</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}
