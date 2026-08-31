"use client";

import { useState } from "react";

export type Contact = { email: string; name: string; source: "self" | "guardian" };
export type Recipient = { id: string; name: string; amount: string; description: string; contacts: Contact[] };

const DEFAULT_NOTE =
  "Reminder: your season fee is due tomorrow. Pay in full or split it into 3 monthly payments using your secure link below. Reply if you need more time or have a question.";

// Consolidated fee-reminder view: pick which unpaid charges to remind AND, per
// charge, which of the payer's addresses receive it — so a reminder can go to
// just the paying parent, not every address on the family's record. An urgent
// note leads every reminder (email + text); "Send a test to myself" delivers
// the exact message to the admin first.
export function FeeReminderList({ ticket, recipients }: { ticket: string; recipients: Recipient[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(recipients.map((r) => r.id)));
  const [note, setNote] = useState(DEFAULT_NOTE);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOn = selected.size === recipients.length;
  const setAll = (on: boolean) => setSelected(on ? new Set(recipients.map((r) => r.id)) : new Set());

  return (
    <div className="space-y-3">
      {/* Urgent note + test-to-myself. The textarea edits shared state; both the
          test form and the send form submit it as name="note". */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Urgent note — shown at the top of every reminder (email &amp; text)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="input w-full text-sm"
          placeholder="e.g. Your season fee is due tomorrow…"
        />
        <form method="POST" action="/api/console/registrations" className="mt-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="sendTestPayment" />
          <input type="hidden" name="note" value={note} />
          <button className="btn-ghost text-sm">Send a test to myself first →</button>
        </form>
      </div>

      <form
        method="POST"
        action="/api/console/registrations"
        onSubmit={(e) => {
          if (selected.size === 0) {
            e.preventDefault();
            return;
          }
          if (!window.confirm(`Send a fee reminder (email + text) to ${selected.size} ${selected.size === 1 ? "family" : "families"}?`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="resendSelectedFees" />
        <input type="hidden" name="note" value={note} />

        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-slate-500">{selected.size} of {recipients.length} selected</span>
          <button type="button" onClick={() => setAll(!allOn)} className="text-xs font-medium text-brand-600 hover:underline">
            {allOn ? "Deselect all" : "Select all"}
          </button>
        </div>

        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {recipients.map((r) => {
            const on = selected.has(r.id);
            return (
              <li key={r.id} className="px-3 py-2">
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" name="paymentId" value={r.id} checked={on} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    <span className="ml-2 text-xs text-slate-400">{r.description}</span>
                  </span>
                  <span className="font-semibold text-slate-700">{r.amount}</span>
                </label>

                {on && (
                  r.contacts.length > 0 ? (
                    <div className="ml-6 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {r.contacts.map((c) => (
                        <label key={c.email} className="flex items-center gap-1.5 text-xs text-slate-600">
                          <input type="checkbox" name={`to_${r.id}`} value={c.email} defaultChecked className="h-3.5 w-3.5" />
                          <span className="font-medium text-slate-700">{c.name}</span>
                          {c.source === "guardian" && <span className="text-[10px] uppercase tracking-wide text-brand-500">guardian</span>}
                          <span className="text-slate-400">{c.email}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="ml-6 mt-1 text-xs text-rose-500">No email on file for this payer.</p>
                  )
                )}
              </li>
            );
          })}
        </ul>

        <button type="submit" disabled={selected.size === 0} className="btn-primary mt-3 text-sm disabled:opacity-50">
          Send reminder to {selected.size} {selected.size === 1 ? "family" : "families"}
        </button>
      </form>
    </div>
  );
}
