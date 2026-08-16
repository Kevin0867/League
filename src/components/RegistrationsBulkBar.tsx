"use client";

import { useEffect, useState } from "react";

// Sticky bulk-action bar for the Registrations grid. The row checkboxes live in
// the table (associated to the hidden <form id="regbulk"> via the form=
// attribute); this bar reads them to show a live count, offers select-all, and
// submits the selection to the bulk waiver / fee ops. Native form posts — no
// client fetch.
export function RegistrationsBulkBar({ ticket }: { ticket: string }) {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[data-regbox]'));
    const refresh = () => {
      const all = boxes();
      setTotal(all.length);
      setCount(all.filter((b) => b.checked).length);
    };
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t as HTMLInputElement).matches?.("input[data-regbox]")) refresh();
    };
    document.addEventListener("change", onChange);
    refresh();
    return () => document.removeEventListener("change", onChange);
  }, []);

  const selectAll = (checked: boolean) => {
    const all = document.querySelectorAll<HTMLInputElement>("input[data-regbox]");
    all.forEach((b) => { b.checked = checked; });
    setCount(checked ? all.length : 0);
  };

  const confirmSend = (verb: string) => (e: React.MouseEvent) => {
    if (count === 0) { e.preventDefault(); return; }
    if (!window.confirm(`${verb} ${count} selected player${count === 1 ? "" : "s"}? This sends real emails.`)) e.preventDefault();
  };

  return (
    <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={total > 0 && count === total} onChange={(e) => selectAll(e.target.checked)} className="h-4 w-4" />
        Select all {total > 0 ? `(${total})` : ""}
      </label>
      <span className="text-sm font-medium text-slate-700">{count} selected</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <input type="hidden" name="ticket" value={ticket} form="regbulk" />
        <button form="regbulk" name="op" value="bulkSendWaiver" onClick={confirmSend("Send the waiver to")} disabled={count === 0} className="btn-secondary text-sm disabled:opacity-40">
          Send waiver{count ? ` to ${count}` : ""}
        </button>
        <button form="regbulk" name="op" value="bulkRequestFee" onClick={confirmSend("Request the season fee from")} disabled={count === 0} className="btn-primary text-sm disabled:opacity-40">
          Request fee{count ? ` from ${count}` : ""}
        </button>
      </div>
    </div>
  );
}
