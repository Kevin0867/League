"use client";

import { useState, useRef, useEffect } from "react";

// Change which player(s) a payment is APPLIED TO (coveredPersonIds) — separate
// from the payer. A parent pays once and the charge can be applied to themselves
// or any of their kids (e.g. an ACP entry fee Chelsi paid, applied to Clayton).
// Submits a native POST (op=applyTo) with one personId field per chosen player.

type Found = { id: string; name: string; email: string | null };

export function ApplyPaymentToControl({
  ticket, paymentId, current, payer,
}: {
  ticket: string;
  paymentId: string;
  /** Players the payment is currently applied to. */
  current: { id: string; name: string }[];
  /** The payer, offered as a one-click "apply to the payer" choice. */
  payer: { id: string; name: string } | null;
}) {
  const [picked, setPicked] = useState<Found[]>(current.map((c) => ({ id: c.id, name: c.name, email: null })));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [open, setOpen] = useState(false);
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
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const add = (f: Found) => { setPicked((p) => (p.some((x) => x.id === f.id) ? p : [...p, f])); setQuery(""); setResults([]); setOpen(false); };
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.id !== id));

  return (
    <details className="mt-1">
      <summary className="cursor-pointer list-none text-xs font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
        {current.length ? "Change who it applies to" : "Apply to a player"}
      </summary>
      <form method="POST" action="/api/console/payments-reconcile" className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="applyTo" />
        <input type="hidden" name="paymentId" value={paymentId} />

        {/* Chosen players become the submitted personId fields */}
        <div className="flex flex-wrap gap-1.5">
          {picked.length === 0 && <span className="text-xs text-slate-400">No player yet — the charge shows under the payer only.</span>}
          {picked.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">
              <input type="hidden" name="personId" value={p.id} />
              {p.name}
              <button type="button" onClick={() => remove(p.id)} className="text-brand-500 hover:text-brand-700" aria-label={`Remove ${p.name}`}>×</button>
            </span>
          ))}
        </div>

        {payer && !picked.some((x) => x.id === payer.id) && (
          <button type="button" onClick={() => add({ id: payer.id, name: payer.name, email: null })} className="text-xs text-slate-500 hover:text-brand-700">
            + Apply to the payer ({payer.name})
          </button>
        )}

        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Search a player by name or email…"
            className="input w-full py-1 text-xs"
          />
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => add(r)} className="flex w-full flex-col items-start px-3 py-1.5 text-left text-xs hover:bg-slate-50">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    {r.email && <span className="text-slate-400">{r.email}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="btn-secondary py-1 text-xs">Save</button>
      </form>
    </details>
  );
}
