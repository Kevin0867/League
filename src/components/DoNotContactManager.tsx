"use client";
import { useRef, useState } from "react";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

// Shown before anyone is opted out, so it's a deliberate, confirmed choice.
const OPT_OUT_WARNING =
  "will receive NO automated or broadcast email or text from PURE Academy — including season announcements — until you turn this back off. Only do this if they asked to stop being contacted. To simply take someone out of a season, withdraw their registration instead.";

type Found = { id: string; name: string; email: string | null };

// Admin control to put a person on (or off) the do-not-contact list. Searches
// everyone — including people with no current registration (e.g. someone who
// withdrew), who otherwise have no console list to find them in — and mutes or
// un-mutes them with a native form POST so the redirect carries the session.
export function DoNotContactManager({
  ticket,
  muted,
  returnTo,
}: {
  ticket: string;
  muted: { id: string; name: string; email: string | null }[];
  returnTo: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedIds = new Set(muted.map((m) => m.id));

  function onChange(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/console/people-search?q=${encodeURIComponent(v.trim())}`);
        const data = await res.json();
        setResults(Array.isArray(data.people) ? data.people : []);
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 250);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Find a person to stop contacting</label>
        <input
          className="input"
          placeholder="Search by name or email…"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        {loading && <p className="mt-1 text-xs text-slate-400">Searching…</p>}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <p className="mt-1 text-xs text-slate-400">No matches.</p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {results.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  {p.email && <span className="ml-2 text-slate-400">{p.email}</span>}
                </span>
                {mutedIds.has(p.id) ? (
                  <span className="whitespace-nowrap text-xs font-medium text-amber-700">Already muted</span>
                ) : (
                  <ConfirmSubmit
                    action="/api/console/people"
                    fields={{ ticket, op: "setDoNotContact", personId: p.id, on: "1", returnTo }}
                    confirmTitle="⚠ Opt this person out of all messages?"
                    confirm={`${p.name} ${OPT_OUT_WARNING}`}
                    confirmLabel="Yes, do not contact"
                    label="Do not contact"
                    className="btn-secondary whitespace-nowrap text-xs"
                    danger
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          On the do-not-contact list ({muted.length})
        </h4>
        {muted.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">No one — everyone is reachable.</p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {muted.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-slate-800">{m.name}</span>
                  {m.email && <span className="ml-2 text-slate-400">{m.email}</span>}
                </span>
                <form method="POST" action="/api/console/people">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="setDoNotContact" />
                  <input type="hidden" name="personId" value={m.id} />
                  <input type="hidden" name="on" value="0" />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button className="btn-chip-muted whitespace-nowrap text-xs">Allow contact again</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
