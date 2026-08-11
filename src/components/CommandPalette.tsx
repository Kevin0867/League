"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Result = { type: string; label: string; sublabel: string; href: string };

// Console-wide quick search. Open with ⌘K / Ctrl+K (or the header button),
// type to search people, coaches, teams, and facilities, arrow to a result,
// Enter to jump.
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    (window as unknown as { __openPalette?: () => void }).__openPalette = () => setOpen(true);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else {
      setQ("");
      setResults([]);
      setActive(0);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/console/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setActive(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback(
    (r: Result) => {
      setOpen(false);
      router.push(r.href);
    },
    [router]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
          }}
          placeholder="Search people, coaches, teams, facilities…"
          className="w-full border-b border-slate-100 px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto">
          {q.trim().length < 2 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Type at least two letters to search.</p>
          ) : loading && results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No matches.</p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.href}-${i}`}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
                  >
                    <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.type}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-slate-800">{r.label}</span>
                      {r.sublabel && <span className="ml-2 text-xs text-slate-400">{r.sublabel}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          <span>↑↓ to navigate · ↵ to open · esc to close</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}

/** A header button that opens the palette (discoverability + mobile, no keyboard). */
export function CommandPaletteButton() {
  return (
    <button
      type="button"
      onClick={() => (window as unknown as { __openPalette?: () => void }).__openPalette?.()}
      className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20 hover:text-white"
      aria-label="Search"
    >
      <span aria-hidden="true">🔍</span>
      <span className="hidden sm:inline">Search</span>
      <span className="hidden rounded bg-white/15 px-1.5 text-[10px] lg:inline">⌘K</span>
    </button>
  );
}
