"use client";

import { useState } from "react";
import {
  createSeason,
  activateSeason,
  addDivision,
  deleteDivision,
  addStandardDivisions,
} from "./actions";

export function CreateSeasonForm() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary">
        + New season
      </button>
    );
  }
  return (
    <form action={createSeason} className="card space-y-3">
      <h3 className="font-semibold text-brand-900">New season</h3>
      <div>
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" className="input" placeholder="PURE Academy — Fall 2026" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="program">Program</label>
          <select id="program" name="program" className="input">
            <option value="PURE_ACADEMY">PURE Academy</option>
            <option value="ACP">Arizona Club Pickleball</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input type="checkbox" name="active" defaultChecked /> Make active
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="startDate">Start date</label>
          <input id="startDate" name="startDate" type="date" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="endDate">End date</label>
          <input id="endDate" name="endDate" type="date" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="opensOn">Registration opens</label>
          <input id="opensOn" name="opensOn" type="date" className="input" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Create season</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}

export function ActivateButton({ seasonId }: { seasonId: string }) {
  return (
    <form action={activateSeason}>
      <input type="hidden" name="seasonId" value={seasonId} />
      <button className="btn-ghost text-xs">Make active</button>
    </form>
  );
}

export function StandardDivisionsButton({ seasonId }: { seasonId: string }) {
  return (
    <form action={addStandardDivisions}>
      <input type="hidden" name="seasonId" value={seasonId} />
      <button className="btn-secondary text-xs">+ Add standard divisions</button>
    </form>
  );
}

export function DeleteDivisionButton({ divisionId }: { divisionId: string }) {
  return (
    <form action={deleteDivision}>
      <input type="hidden" name="divisionId" value={divisionId} />
      <button className="text-xs text-rose-600 hover:underline">Remove</button>
    </form>
  );
}

export function AddDivisionForm({ seasonId }: { seasonId: string }) {
  const [type, setType] = useState("DUPR_BAND");
  return (
    <form action={addDivision} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="seasonId" value={seasonId} />
      <div>
        <label className="label text-xs">Division name</label>
        <input name="name" className="input py-1.5" placeholder="Adult 3.0–3.5" required />
      </div>
      <div>
        <label className="label text-xs">Type</label>
        <select name="divisionType" value={type} onChange={(e) => setType(e.target.value)} className="input py-1.5">
          <option value="DUPR_BAND">DUPR band</option>
          <option value="SCHOOL_LEVEL">School level</option>
        </select>
      </div>
      {type === "DUPR_BAND" && (
        <>
          <div className="w-20">
            <label className="label text-xs">Min</label>
            <input name="minRating" type="number" step="0.1" className="input py-1.5" placeholder="3.0" />
          </div>
          <div className="w-20">
            <label className="label text-xs">Max</label>
            <input name="maxRating" type="number" step="0.1" className="input py-1.5" placeholder="3.5" />
          </div>
        </>
      )}
      <button type="submit" className="btn-primary py-1.5">Add</button>
    </form>
  );
}
