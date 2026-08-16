"use client";

import { useState } from "react";
import {
  SCORING_PRESETS,
  SERVE_TYPES,
  POINTS_TO_OPTIONS,
  GAMES_TO_WIN_OPTIONS,
  type ScoringFormat,
} from "@/lib/domain/scoringFormat";

// Composable scoring-format controls used on the schedule-a-slot form and the
// match page. A preset dropdown fills every knob at once; the knobs stay
// editable for anything off-preset. Renders plain form fields (serveType,
// pointsTo, gamesToWin, winByTwo, freezeAt) so the server reads them directly.
export function ScoringFormatFields({ value, compact = false }: { value: ScoringFormat; compact?: boolean }) {
  const [fmt, setFmt] = useState<ScoringFormat>(value);
  const set = (patch: Partial<ScoringFormat>) => setFmt((f) => ({ ...f, ...patch }));

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div>
        <label className="label">Quick preset</label>
        <select
          className="input"
          defaultValue=""
          onChange={(e) => {
            const p = SCORING_PRESETS.find((x) => x.key === e.target.value);
            if (p) setFmt(p.format);
          }}
        >
          <option value="">Choose a preset…</option>
          {SCORING_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label text-xs">Match length</label>
          <select name="gamesToWin" className="input" value={fmt.gamesToWin} onChange={(e) => set({ gamesToWin: Number(e.target.value) })}>
            {GAMES_TO_WIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Points to</label>
          <select name="pointsTo" className="input" value={fmt.pointsTo} onChange={(e) => set({ pointsTo: Number(e.target.value) })}>
            {POINTS_TO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Win by 2</label>
          <select name="winByTwo" className="input" value={fmt.winByTwo ? "true" : "false"} onChange={(e) => set({ winByTwo: e.target.value === "true" })}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div>
          <label className="label text-xs">Serve</label>
          <select name="serveType" className="input" value={fmt.serveType} onChange={(e) => set({ serveType: e.target.value })}>
            {SERVE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.value === "RALLY" ? "Rally scoring" : "Traditional (side-out)"}</option>)}
          </select>
        </div>
        {fmt.serveType === "RALLY" && (
          <div className="sm:col-span-2">
            <label className="label text-xs">Freeze at <span className="font-normal text-slate-400">(rally only; blank = none)</span></label>
            <input
              name="freezeAt"
              type="number"
              min={1}
              max={99}
              className="input"
              placeholder="e.g. 20"
              value={fmt.freezeAt ?? ""}
              onChange={(e) => set({ freezeAt: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
        )}
        {/* Keep a value flowing for freezeAt even when side-out hides the input. */}
        {fmt.serveType !== "RALLY" && <input type="hidden" name="freezeAt" value="" />}
      </div>
    </div>
  );
}
