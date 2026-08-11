"use client";

import { useState } from "react";
import { ACP_MIN_PLAYERS, ACP_MAX_PLAYERS, ACP_FEE_PER_PLAYER_CENTS } from "@/lib/domain/acpEntry";

// Division options for the entry form. Youth by school level; adults by DUPR
// band. Adult bands require a DUPR rating per player (validated server-side).
const DIVISIONS = [
  { group: "Youth", options: ["Elementary", "Middle School", "High School"] },
  {
    group: "Women's (by DUPR)",
    options: ["Women's 2.5", "Women's 3.0", "Women's 3.5", "Women's 4.0", "Women's 4.5", "Women's 5.0+"],
  },
  {
    group: "Men's (by DUPR)",
    options: ["Men's 2.5", "Men's 3.0", "Men's 3.5", "Men's 4.0", "Men's 4.5", "Men's 5.0+"],
  },
];

const ERRORS: Record<string, string> = {
  club: "Enter your club name.",
  contact: "Enter the team contact's name and a valid email.",
  division: "Choose the division you're entering.",
  roster: "Check your roster — see the requirements above.",
};

export function AcpEntryForm({ err, detail }: { err?: string; detail?: string }) {
  const [rows, setRows] = useState(ACP_MIN_PLAYERS);
  const [division, setDivision] = useState("");

  const isAdult = /^(men|women)/i.test(division);
  const fee = (rows * ACP_FEE_PER_PLAYER_CENTS) / 100;

  return (
    <form method="POST" action="/api/acp/enter" className="mt-6 space-y-6">
      {err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {detail || ERRORS[err] || "Please check the form and try again."}
        </p>
      )}

      {/* Club + contact */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Club name *</label>
          <input name="clubName" className="input" required />
        </div>
        <div>
          <label className="label">Market / city</label>
          <input name="market" className="input" placeholder="e.g. Scottsdale" />
        </div>
        <div>
          <label className="label">Team contact — name *</label>
          <input name="contactName" className="input" required />
          <p className="mt-1 text-xs text-slate-400">The captain or organizer who holds the roster and answers scheduling.</p>
        </div>
        <div>
          <label className="label">Team contact — email *</label>
          <input name="contactEmail" type="email" className="input" required />
        </div>
        <div>
          <label className="label">Team contact — phone</label>
          <input name="contactPhone" type="tel" className="input" />
        </div>
        <div>
          <label className="label">Division *</label>
          <select
            name="divisionName"
            className="input"
            required
            value={division}
            onChange={(e) => setDivision(e.target.value)}
          >
            <option value="">Choose a division…</option>
            {DIVISIONS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Roster */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Roster</h3>
          <p className="text-sm text-slate-500">{ACP_MIN_PLAYERS}–{ACP_MAX_PLAYERS} players</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {isAdult
            ? "Adult divisions are seeded by DUPR — enter a DUPR rating for every player. Players may play up a band, never down."
            : "Youth divisions don't require a DUPR rating."}
        </p>

        <div className="mt-3 space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input name="playerName" className="input sm:col-span-5" placeholder={`Player ${i + 1} name`} required={i < ACP_MIN_PLAYERS} />
              <input name="playerEmail" type="email" className="input sm:col-span-4" placeholder="Email (optional)" />
              <input
                name="playerDupr"
                className="input sm:col-span-3"
                inputMode="decimal"
                placeholder={isAdult ? "DUPR *" : "DUPR"}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setRows((r) => Math.min(ACP_MAX_PLAYERS, r + 1))}
            disabled={rows >= ACP_MAX_PLAYERS}
            className="btn-secondary disabled:opacity-40"
          >
            + Add player
          </button>
          <button
            type="button"
            onClick={() => setRows((r) => Math.max(ACP_MIN_PLAYERS, r - 1))}
            disabled={rows <= ACP_MIN_PLAYERS}
            className="text-slate-500 hover:text-rose-600 disabled:opacity-40"
          >
            Remove last
          </button>
        </div>
      </div>

      {/* Fee summary */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600">
            {rows} players × $195
          </div>
          <div className="text-2xl font-extrabold text-brand-900 tabular-nums">
            ${fee.toLocaleString("en-US", { minimumFractionDigits: 0 })}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          We&apos;ll email a secure payment link to the team contact after you submit. Your place is confirmed once
          payment clears.
        </p>
      </div>

      <button className="btn-primary w-full sm:w-auto">Submit entry</button>
    </form>
  );
}
