"use client";

import { useState } from "react";

type Team = { id: string; name: string };

export function RowActions({
  ticket,
  personId,
  registrationId,
  assigned,
  currentTeamId,
  teams,
  payStatus,
}: {
  ticket: string;
  personId: string;
  registrationId: string;
  assigned: boolean;
  currentTeamId: string | null;
  teams: Team[];
  payStatus: "none" | "requested" | "paid" | "refunded";
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

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        Actions ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            {/* Assign / move */}
            <form method="POST" action="/api/console/registrations" className="space-y-2">
              <Hidden op="assignToTeam" />
              <label className="block text-xs font-medium text-slate-500">
                {assigned ? "Move to team" : "Assign to team"}
              </label>
              <select name="teamId" defaultValue={currentTeamId ?? ""} className="input py-1 text-sm">
                <option value="">— Select a team —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
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

            <div className="border-t border-slate-100 pt-2">
              {payStatus === "paid" ? (
                <form method="POST" action="/api/console/registrations">
                  <Hidden op="refund" />
                  <button className="w-full rounded-md border border-rose-200 py-1 text-xs text-rose-600 hover:bg-rose-50">
                    Start refund
                  </button>
                </form>
              ) : payStatus === "requested" ? (
                <p className="text-center text-xs text-slate-400">Fee already requested</p>
              ) : payStatus === "refunded" ? (
                <p className="text-center text-xs text-slate-400">Fee refunded</p>
              ) : (
                <form method="POST" action="/api/console/registrations">
                  <Hidden op="requestFee" />
                  <button className="btn-secondary w-full py-1 text-xs">Request season fee</button>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
