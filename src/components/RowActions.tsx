"use client";

import { useState } from "react";
import type { FeeState } from "@/lib/domain/feeStatus";

type Team = { id: string; name: string; dayTime?: string | null };

export function RowActions({
  ticket,
  personId,
  registrationId,
  assigned,
  currentTeamId,
  teams,
  payStatus,
  waiverSigned,
  sharedInvoice = false,
}: {
  ticket: string;
  personId: string;
  registrationId: string;
  assigned: boolean;
  currentTeamId: string | null;
  teams: Team[];
  payStatus: FeeState;
  waiverSigned: boolean;
  /** This player shares one not-yet-paid invoice with others (a consolidated
   *  family fee) — offer to split them onto their own per-player invoice. */
  sharedInvoice?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const Hidden = ({ op }: { op: string }) => (
    <>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="registrationId" value={registrationId} />
    </>
  );

  const confirmSend = (msg: string) => (e: React.FormEvent) => {
    if (!window.confirm(msg)) e.preventDefault();
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      {/* Fee — the most common next action, one click */}
      {payStatus === "paid" ? (
        <span className="badge bg-emerald-100 text-emerald-800">✓ paid</span>
      ) : payStatus === "subscription" ? (
        <span className="badge bg-emerald-100 text-emerald-800" title="On the 3-payment plan — signed up and first payment made.">✓ subscription</span>
      ) : payStatus === "refunded" ? (
        <span className="badge bg-slate-100 text-slate-500">refunded</span>
      ) : (
        <form
          method="POST"
          action="/api/console/registrations"
          onSubmit={confirmSend(payStatus === "unpaid" ? "Resend the fee request email to this family?" : "Email the season fee request to this family?")}
        >
          <Hidden op={payStatus === "unpaid" ? "resendPayment" : "requestFee"} />
          {payStatus === "unpaid" && <input type="hidden" name="from" value="list" />}
          <button className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
            {payStatus === "unpaid" ? "Resend fee" : "Request fee"}
          </button>
        </form>
      )}

      {/* Split — visible when this player shares one unpaid family invoice with
          someone else (e.g. a father and son on two different teams). */}
      {sharedInvoice && (
        <form
          method="POST"
          action="/api/console/registrations"
          onSubmit={confirmSend("Split this family's fee into a separate invoice for each player? Each player will then have their own pay link.")}
        >
          <Hidden op="splitFee" />
          <button className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100" title="This player shares one invoice with another family member — split them apart.">
            Split fee
          </button>
        </form>
      )}

      {/* Waiver — direct when outstanding */}
      {!waiverSigned && (
        <form method="POST" action="/api/console/registrations" onSubmit={confirmSend("Email the waiver link to this family?")}>
          <Hidden op="sendWaiver" />
          <button className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">
            Send waiver
          </button>
        </form>
      )}

      {/* Assign / move (needs a team choice) + refund live in a compact popover */}
      <div className="relative inline-block text-left">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {assigned ? "Move ▾" : "Assign ▾"}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-64 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <form method="POST" action="/api/console/registrations" className="space-y-2">
                <Hidden op="assignToTeam" />
                <label className="block text-xs font-medium text-slate-500">{assigned ? "Move to team" : "Assign to team"}</label>
                {(() => {
                  const cur = teams.find((t) => t.id === currentTeamId);
                  return cur ? (
                    <p className="text-[11px] text-slate-500">
                      Currently on <span className="font-medium text-slate-700">{cur.name}</span>
                      {cur.dayTime ? <span className="text-slate-500"> · {cur.dayTime}</span> : null}
                    </p>
                  ) : null;
                })()}
                <select name="teamId" defaultValue={currentTeamId ?? ""} className="input py-1 text-sm">
                  <option value="">— Select a team —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.dayTime ? ` · ${t.dayTime}` : ""}</option>
                  ))}
                </select>
                <button className="btn-primary w-full py-1 text-xs">{assigned ? "Move" : "Assign"}</button>
              </form>

              {assigned && (
                <form method="POST" action="/api/console/registrations">
                  <Hidden op="unassign" />
                  <button className="w-full rounded-md border border-slate-200 py-1 text-xs text-slate-600 hover:bg-slate-50">
                    Send back to pool
                  </button>
                </form>
              )}

              {payStatus === "paid" && (
                <div className="border-t border-slate-100 pt-2">
                  <form method="POST" action="/api/console/registrations" onSubmit={confirmSend("Start a refund for this family's paid fee?")}>
                    <Hidden op="refund" />
                    <button className="w-full rounded-md border border-rose-200 py-1 text-xs text-rose-600 hover:bg-rose-50">
                      Start refund
                    </button>
                  </form>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
