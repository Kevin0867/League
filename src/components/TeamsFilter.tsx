"use client";

import { useEffect, useState } from "react";

// Filter the /teams list by market and division without restructuring the
// server-rendered, market-grouped layout: it toggles [data-team-card] elements
// by their data-market/data-division and hides any market section left empty.
export function TeamsFilter({ markets, divisions }: { markets: string[]; divisions: string[] }) {
  const [market, setMarket] = useState("");
  const [division, setDivision] = useState("");

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-team-card]").forEach((c) => {
      const mOk = !market || c.dataset.market === market;
      const dOk = !division || c.dataset.division === division;
      c.style.display = mOk && dOk ? "" : "none";
    });
    document.querySelectorAll<HTMLElement>("[data-market-section]").forEach((s) => {
      const anyVisible = [...s.querySelectorAll<HTMLElement>("[data-team-card]")].some((c) => c.style.display !== "none");
      s.style.display = anyVisible ? "" : "none";
    });
  }, [market, division]);

  return (
    <div className="mt-6 flex flex-wrap gap-2">
      <select value={market} onChange={(e) => setMarket(e.target.value)} className="input max-w-[12rem] py-1.5 text-sm" aria-label="Filter by market">
        <option value="">All markets</option>
        {markets.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={division} onChange={(e) => setDivision(e.target.value)} className="input max-w-[12rem] py-1.5 text-sm" aria-label="Filter by division">
        <option value="">All divisions</option>
        {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      {(market || division) && (
        <button type="button" onClick={() => { setMarket(""); setDivision(""); }} className="text-sm text-slate-500 hover:text-brand-700 hover:underline">
          Clear
        </button>
      )}
    </div>
  );
}
