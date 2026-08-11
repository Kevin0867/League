"use client";

import { useState } from "react";

export type Recipient = { id: string; name: string; amount: string; description: string };

// Consolidated fee-reminder view: shows exactly who will receive a reminder,
// with per-recipient checkboxes, so an admin selects/deselects before sending
// real email — no more blind "resend to everyone".
export function FeeReminderList({ ticket, recipients }: { ticket: string; recipients: Recipient[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(recipients.map((r) => r.id)));

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
    <form
      method="POST"
      action="/api/console/registrations"
      onSubmit={(e) => {
        if (selected.size === 0) {
          e.preventDefault();
          return;
        }
        if (!window.confirm(`Email a fee reminder to ${selected.size} ${selected.size === 1 ? "recipient" : "recipients"}?`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="resendSelectedFees" />

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-500">{selected.size} of {recipients.length} selected</span>
        <button type="button" onClick={() => setAll(!allOn)} className="text-xs font-medium text-brand-600 hover:underline">
          {allOn ? "Deselect all" : "Select all"}
        </button>
      </div>

      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {recipients.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                name="paymentId"
                value={r.id}
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="ml-2 text-xs text-slate-400">{r.description}</span>
              </span>
              <span className="font-semibold text-slate-700">{r.amount}</span>
            </label>
          </li>
        ))}
      </ul>

      <button type="submit" disabled={selected.size === 0} className="btn-secondary mt-3 text-sm disabled:opacity-50">
        Send reminders to {selected.size} selected
      </button>
    </form>
  );
}
