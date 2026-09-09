"use client";

import { useState, useRef, useEffect } from "react";

// One unmatched Stripe-CSV charge on Payments: the charge names no player we can
// find (often only the payer's email is on it), so an admin assigns it to a
// player by hand here. Picking a family and submitting marks that player's fee
// PAID for this charge — recording the Stripe charge id so a later CSV re-upload
// never double-counts it. Native POST (op=assign-csv-charge).

type Found = { id: string; name: string; email: string | null };

export function AssignCsvChargeRow({
  ticket,
  chargeId,
  amount,
  amountCents,
  who,
  remaining,
}: {
  ticket: string;
  chargeId: string;
  amount: string;
  amountCents: number;
  /** What Stripe had on the charge — usually the payer's email. */
  who: string;
  /** The full unmatched list (raw param), so the route can re-show the rest
   *  after this one is assigned — no CSV re-upload needed between assignments. */
  remaining: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
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
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const isEmail = /@/.test(who);

  return (
    <form method="POST" action="/api/console/payments-reconcile" className="flex flex-wrap items-center gap-2 border-t border-amber-200/70 py-2.5 text-sm">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="assign-csv-charge" />
      <input type="hidden" name="chargeId" value={chargeId} />
      <input type="hidden" name="amountCents" value={String(amountCents)} />
      <input type="hidden" name="payerEmail" value={isEmail ? who : ""} />
      <input type="hidden" name="personId" value={picked?.id ?? ""} />
      <input type="hidden" name="remaining" value={remaining} />

      <div className="w-24 shrink-0 font-semibold text-amber-900">{amount}</div>
      <div className="w-52 shrink-0 truncate text-xs text-amber-700" title={who}>{who}</div>

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
              placeholder="Search a player by name or email…"
              className="w-full rounded-lg border border-amber-300 px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
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

      <button
        type="submit"
        disabled={!picked}
        className="btn-primary shrink-0 px-4 py-1.5 text-sm disabled:opacity-40"
        title={picked ? "" : "Pick a player first"}
      >
        Mark paid
      </button>
    </form>
  );
}
