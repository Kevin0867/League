"use client";

import { useState, useRef, useEffect } from "react";

// One imported-charge row on Payments: shows the amount / date / payer email and
// lets an admin attach it to a family (searchable) and set its real category, so
// the charge lands in the right reports. Submits a native POST (op=attribute).

type Found = { id: string; name: string; email: string | null };

const CATEGORIES: Array<[string, string]> = [
  ["PLAYER_FEE", "Season fee"],
  ["APPAREL", "Apparel"],
  ["ALA_CARTE", "Private lesson / clinic"],
  ["ACP_ENTRY", "ACP entry"],
  ["CUSTOM", "Other / custom"],
];

export function AttributeImportRow({
  ticket,
  paymentId,
  amount,
  date,
  payerEmail,
  suggestion,
}: {
  ticket: string;
  paymentId: string;
  amount: string;
  date: string;
  payerEmail: string | null;
  /** Best-guess person from the payer email, offered as a one-click attach. */
  suggestion: Found | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(suggestion);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("PLAYER_FEE");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/console/people-search?q=${encodeURIComponent(query.trim())}`);
        const data = (await res.json().catch(() => ({}))) as { people?: Found[] };
        setResults(data.people ?? []);
        setOpen(true);
      } catch { /* ignore */ }
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return (
    <form method="POST" action="/api/console/payments-reconcile" className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2.5 text-sm">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="attribute" />
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="personId" value={picked?.id ?? ""} />

      <div className="w-24 shrink-0 font-semibold text-slate-800">{amount}</div>
      <div className="w-20 shrink-0 text-xs text-slate-400">{date}</div>
      <div className="w-44 shrink-0 truncate text-xs text-slate-500" title={payerEmail ?? ""}>{payerEmail ?? "no email on charge"}</div>

      {/* Person picker */}
      <div className="relative min-w-[200px] flex-1">
        {picked ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5">
            <span className="truncate text-emerald-900">{picked.name}{picked.email ? <span className="text-emerald-600"> · {picked.email}</span> : ""}</span>
            <button type="button" onClick={() => { setPicked(null); setQuery(""); }} className="ml-auto text-xs text-emerald-700 hover:underline">change</button>
          </div>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length && setOpen(true)}
              placeholder="Search a family by name or email…"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
            />
            {open && results.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => { setPicked(r); setOpen(false); }}
                      className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-800">{r.name}</span>
                      {r.email ? <span className="text-xs text-slate-400"> · {r.email}</span> : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <select
        name="category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
      >
        {CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>

      <button
        type="submit"
        disabled={!picked}
        className="btn-primary shrink-0 px-4 py-1.5 text-sm disabled:opacity-40"
        title={picked ? "" : "Pick a family first"}
      >
        Attach
      </button>
    </form>
  );
}
