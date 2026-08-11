"use client";

import { useEffect, useRef, useState } from "react";

// A reusable, no-restructure search box for server-rendered tables/lists. Give
// the target table (or any container) an id and its rows a `data-filter-row`
// marker; this filters them client-side by visible text. Works on any section
// without threading the data through a client component.
export function TableFilter({
  targetId,
  placeholder = "Search…",
  label,
}: {
  targetId: string;
  placeholder?: string;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-filter-row]"));
    const query = q.trim().toLowerCase();
    let visible = 0;
    for (const r of rows) {
      const hay = (r.getAttribute("data-filter-text") || r.textContent || "").toLowerCase();
      const show = !query || hay.includes(query);
      r.hidden = !show;
      if (show) visible++;
    }
    const empty = root.querySelector<HTMLElement>("[data-filter-empty]");
    if (empty) empty.hidden = !(query && visible === 0);
    setCount(query ? visible : null);
  }, [q, targetId]);

  return (
    <div className="relative">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="input pl-9"
      />
      {count !== null && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          {count} match{count === 1 ? "" : "es"}
        </span>
      )}
    </div>
  );
}
