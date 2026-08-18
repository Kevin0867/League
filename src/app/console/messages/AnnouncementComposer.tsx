"use client";

import { useState } from "react";

const CATS = [
  { name: "players", label: "All players" },
  { name: "parents", label: "All parents" },
  { name: "coaches", label: "All coaches" },
  { name: "admins", label: "All admins" },
] as const;

// counts is keyed by the sorted, comma-joined category names for each non-empty
// combination (e.g. "coaches,players") → deduped recipient count.
export function AnnouncementComposer({ ticket, counts }: { ticket: string; counts: Record<string, number> }) {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const chosen = CATS.filter((c) => sel[c.name]).map((c) => c.name);
  const key = chosen.slice().sort().join(",");
  const count = key ? counts[key] ?? 0 : 0;

  return (
    <div className="card border-l-4 border-brand-500">
      <h2 className="font-semibold text-slate-900">Platform announcement</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        For big news that affects everyone. Tick the groups to reach, write your message, and send one announcement to
        everyone selected — deduped, and logged like every other message.
      </p>
      <form method="POST" action="/api/console/messages" className="mt-3 space-y-3">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="announce" />
        <div className="flex flex-wrap items-center gap-2">
          {CATS.map((c) => (
            <label
              key={c.name}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${sel[c.name] ? "border-brand-400 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
            >
              <input
                type="checkbox"
                name={`cat_${c.name}`}
                checked={!!sel[c.name]}
                onChange={(e) => setSel((s) => ({ ...s, [c.name]: e.target.checked }))}
              />
              {c.label}
            </label>
          ))}
          <span className={`ml-1 text-sm font-semibold ${key ? "text-brand-700" : "text-slate-400"}`}>
            {key ? `→ ${count.toLocaleString()} recipient${count === 1 ? "" : "s"}` : "Select at least one group"}
          </span>
        </div>
        <input name="subject" className="input" placeholder="Subject (optional)" />
        <textarea name="body" required rows={4} className="input" placeholder="Write your announcement…" />
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Send by</span>
          <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" name="channel_IN_APP" defaultChecked /> In-app</label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" name="channel_EMAIL" defaultChecked /> Email</label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" name="channel_SMS" defaultChecked /> SMS</label>
        </div>
        <div className="flex items-center justify-end gap-3">
          {key && <span className="text-xs text-slate-400">Goes to {count.toLocaleString()} {count === 1 ? "person" : "people"}</span>}
          <button className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled={!key}>Send announcement</button>
        </div>
      </form>
    </div>
  );
}
