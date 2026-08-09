"use client";

import { useState } from "react";

export function FacilityForm({ ticket }: { ticket: string }) {
  const [open, setOpen] = useState(false);
  const [feeBasis, setFeeBasis] = useState("NONE");
  const [isPrivate, setIsPrivate] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Add facility
      </button>
    );
  }

  const perRate = feeBasis === "PER_COURT" || feeBasis === "PER_HOUR" || feeBasis === "PER_SESSION";

  return (
    <form method="POST" action="/api/console/facilities" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <h3 className="font-semibold text-brand-900">Add facility</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" className="input" placeholder="Scottsdale Ranch Pickleball Complex" required />
        </div>
        <div>
          <label className="label">Market / city</label>
          <input name="market" className="input" placeholder="Scottsdale" />
        </div>
        <div>
          <label className="label">Court count</label>
          <input name="courtCount" type="number" min="0" className="input" defaultValue={0} />
        </div>
        <div>
          <label className="label">Agreement status</label>
          <select name="agreementStatus" className="input">
            <option value="IDENTIFIED">Identified</option>
            <option value="VERBAL">Verbal</option>
            <option value="AGREEMENT_SENT">Agreement sent</option>
            <option value="EXECUTED">Executed</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Fee basis</label>
          <select name="feeBasis" value={feeBasis} onChange={(e) => setFeeBasis(e.target.value)} className="input">
            <option value="NONE">No fee / in-kind</option>
            <option value="PER_COURT">Per court</option>
            <option value="PER_HOUR">Per hour</option>
            <option value="PER_SESSION">Per session</option>
            <option value="PERCENTAGE">Percentage of on-site revenue</option>
          </select>
        </div>
        {perRate && (
          <>
            <div>
              <label className="label">Weekday rate ($)</label>
              <input name="weekdayRate" type="number" step="0.01" className="input" placeholder="0.00" />
            </div>
            <div>
              <label className="label">Weekend rate ($)</label>
              <input name="weekendRate" type="number" step="0.01" className="input" placeholder="0.00" />
            </div>
          </>
        )}
        {feeBasis === "PERCENTAGE" && (
          <div>
            <label className="label">Percentage (%)</label>
            <input name="percentageRate" type="number" step="0.1" className="input" placeholder="15" />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Primary contact</label>
          <input name="primaryContact" className="input" />
        </div>
        <div>
          <label className="label">Contact email</label>
          <input name="contactEmail" type="email" className="input" />
        </div>
        <div>
          <label className="label">Contact phone</label>
          <input name="contactPhone" className="input" />
        </div>
      </div>

      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="alaCarteAllowed" /> À la carte allowed
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="acpLeagueOption" /> ACP league option
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPrivate" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Private residence/court
        </label>
      </div>

      {isPrivate ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Public general area</label>
            <input name="generalArea" className="input" placeholder="North Scottsdale" />
            <p className="mt-1 text-xs text-slate-400">Shown publicly. Never the owner name or street address.</p>
          </div>
          <div>
            <label className="label">Exact address (behind login)</label>
            <input name="exactAddress" className="input" />
            <p className="mt-1 text-xs text-slate-400">Released only to assigned players.</p>
          </div>
        </div>
      ) : (
        <div>
          <label className="label">Address</label>
          <input name="exactAddress" className="input" />
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Create facility</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}
