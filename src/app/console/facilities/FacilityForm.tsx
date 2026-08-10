"use client";

import { useState } from "react";

export type FacilityInitial = {
  id: string;
  name: string;
  market: string | null;
  courtCount: number;
  agreementStatus: string;
  feeBasis: string;
  weekdayRateCents: number;
  weekendRateCents: number;
  percentageRate: number | null;
  primaryContact: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isPrivate: boolean;
  generalArea: string | null;
  exactAddress: string | null;
  alaCarteAllowed: boolean;
  acpLeagueOption: boolean;
};

const dollars = (cents: number) => (cents ? (cents / 100).toFixed(2) : "");

// One form, two modes: add a facility (no `facility`) or edit an existing one.
export function FacilityForm({ ticket, facility }: { ticket: string; facility?: FacilityInitial }) {
  const editing = !!facility;
  const [open, setOpen] = useState(false);
  const [feeBasis, setFeeBasis] = useState(facility?.feeBasis ?? "NONE");
  const [isPrivate, setIsPrivate] = useState(facility?.isPrivate ?? false);

  if (!open) {
    return editing ? (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-brand-700 hover:underline">Edit</button>
    ) : (
      <button onClick={() => setOpen(true)} className="btn-primary">+ Add facility</button>
    );
  }

  const perRate = feeBasis === "PER_COURT" || feeBasis === "PER_HOUR" || feeBasis === "PER_SESSION";

  return (
    <form method="POST" action="/api/console/facilities" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={editing ? "edit" : "create"} />
      {editing && <input type="hidden" name="facilityId" value={facility!.id} />}
      <h3 className="font-semibold text-brand-900">{editing ? `Edit ${facility!.name}` : "Add facility"}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" className="input" placeholder="Scottsdale Ranch Pickleball Complex" defaultValue={facility?.name ?? ""} required />
        </div>
        <div>
          <label className="label">Market / city</label>
          <input name="market" className="input" placeholder="Scottsdale" defaultValue={facility?.market ?? ""} />
        </div>
        <div>
          <label className="label">Court count</label>
          <input name="courtCount" type="number" min="0" className="input" defaultValue={facility?.courtCount ?? 0} />
        </div>
        <div>
          <label className="label">Agreement status</label>
          <select name="agreementStatus" className="input" defaultValue={facility?.agreementStatus ?? "IDENTIFIED"}>
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
              <input name="weekdayRate" type="number" step="0.01" className="input" placeholder="0.00" defaultValue={dollars(facility?.weekdayRateCents ?? 0)} />
            </div>
            <div>
              <label className="label">Weekend rate ($)</label>
              <input name="weekendRate" type="number" step="0.01" className="input" placeholder="0.00" defaultValue={dollars(facility?.weekendRateCents ?? 0)} />
            </div>
          </>
        )}
        {feeBasis === "PERCENTAGE" && (
          <div>
            <label className="label">Percentage (%)</label>
            <input name="percentageRate" type="number" step="0.1" className="input" placeholder="15" defaultValue={facility?.percentageRate ? String((facility.percentageRate * 100).toFixed(0)) : ""} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Primary contact</label>
          <input name="primaryContact" className="input" defaultValue={facility?.primaryContact ?? ""} />
        </div>
        <div>
          <label className="label">Contact email</label>
          <input name="contactEmail" type="email" className="input" defaultValue={facility?.contactEmail ?? ""} />
        </div>
        <div>
          <label className="label">Contact phone</label>
          <input name="contactPhone" className="input" defaultValue={facility?.contactPhone ?? ""} />
        </div>
      </div>

      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="alaCarteAllowed" defaultChecked={facility?.alaCarteAllowed ?? false} /> À la carte allowed
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="acpLeagueOption" defaultChecked={facility?.acpLeagueOption ?? false} /> ACP league option
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
            <input name="generalArea" className="input" placeholder="North Scottsdale" defaultValue={facility?.generalArea ?? ""} />
            <p className="mt-1 text-xs text-slate-400">Shown publicly. Never the owner name or street address.</p>
          </div>
          <div>
            <label className="label">Exact address (behind login)</label>
            <input name="exactAddress" className="input" defaultValue={facility?.exactAddress ?? ""} />
            <p className="mt-1 text-xs text-slate-400">Released only to assigned players.</p>
          </div>
        </div>
      ) : (
        <div>
          <label className="label">Address</label>
          <input name="exactAddress" className="input" defaultValue={facility?.exactAddress ?? ""} />
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">{editing ? "Save changes" : "Create facility"}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}
