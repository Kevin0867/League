"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOption = { id: string; name: string; hint?: string };

// A searchable single-select combobox that submits its choice through a hidden
// input named `name`, so it drops into any native-POST form in place of a long
// <select>. Type to filter; click (or Enter) to choose. When `required`, the
// browser blocks submit with a clear message until a real option is picked.
export function SearchableSelect({
  name,
  options,
  placeholder = "Search…",
  required = false,
  defaultId = "",
  id,
}: {
  name: string;
  options: SearchOption[];
  placeholder?: string;
  required?: boolean;
  defaultId?: string;
  id?: string;
}) {
  const initial = options.find((o) => o.id === defaultId) ?? null;
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [query, setQuery] = useState(initial?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // When a selection is showing (query equals its name), list everything so
    // the user can browse; otherwise filter by the typed text.
    const showAll = !q || (!!selectedId && options.some((o) => o.id === selectedId && o.name.toLowerCase() === q));
    const list = showAll ? options : options.filter((o) => `${o.name} ${o.hint ?? ""}`.toLowerCase().includes(q));
    return list.slice(0, 50);
  }, [query, options, selectedId]);

  // Native form validity: require a real pick, not just typed text.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setCustomValidity(required && !selectedId ? "Please choose a person from the list." : "");
    }
  }, [required, selectedId]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (o: SearchOption) => {
    setSelectedId(o.id);
    setQuery(o.name);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name={name} value={selectedId} />
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="input"
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelectedId(""); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { if (open && filtered[active]) { e.preventDefault(); pick(filtered[active]); } }
          else if (e.key === "Escape") { setOpen(false); }
        }}
      />
      {selectedId && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => { setSelectedId(""); setQuery(""); setOpen(true); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:text-slate-600"
        >
          ×
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
              >
                <span className="truncate text-slate-800">{o.name}</span>
                {o.hint && <span className="shrink-0 text-xs text-slate-400">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg">
          No matches.
        </div>
      )}
    </div>
  );
}
