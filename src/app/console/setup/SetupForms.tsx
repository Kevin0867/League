"use client";

import { useState } from "react";

export function CreateSeasonForm({ ticket }: { ticket: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary">
        + New season
      </button>
    );
  }
  return (
    <form method="POST" action="/api/console/setup" className="card space-y-3">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="createSeason" />
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="startDate">Start date</label>
          <input id="startDate" name="startDate" type="date" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="endDate">End date</label>
          <input id="endDate" name="endDate" type="date" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="opensOn">Registration opens <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="opensOn" name="opensOn" type="date" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="closesOn">Registration closes <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="closesOn" name="closesOn" type="date" className="input" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Create season</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}

export function EditSeasonForm({
  ticket,
  season,
}: {
  ticket: string;
  season: { id: string; name: string; program: string; startDate: string; endDate: string; opensOn: string; closesOn: string };
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-ghost text-xs">Edit</button>;
  }
  return (
    <form method="POST" action="/api/console/setup" className="mt-3 w-full space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="editSeason" />
      <input type="hidden" name="seasonId" value={season.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Name</label><input name="name" className="input" defaultValue={season.name} required /></div>
        <div>
          <label className="label">Program</label>
          <select name="program" className="input" defaultValue={season.program}>
            <option value="PURE_ACADEMY">PURE Academy</option>
            <option value="ACP">Arizona Club Pickleball</option>
          </select>
        </div>
        <div><label className="label">Start date</label><input name="startDate" type="date" className="input" defaultValue={season.startDate} /></div>
        <div><label className="label">End date</label><input name="endDate" type="date" className="input" defaultValue={season.endDate} /></div>
        <div><label className="label">Registration opens <span className="font-normal text-slate-400">(optional)</span></label><input name="opensOn" type="date" className="input" defaultValue={season.opensOn} /></div>
        <div><label className="label">Registration closes <span className="font-normal text-slate-400">(optional)</span></label><input name="closesOn" type="date" className="input" defaultValue={season.closesOn} /></div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Save season</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}

export function SeasonFeeForm({ ticket, currentFeeCents }: { ticket: string; currentFeeCents: number }) {
  return (
    <form method="POST" action="/api/console/setup" className="flex items-end gap-2">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="setSeasonFee" />
      <div>
        <label className="label text-xs">Season fee ($)</label>
        <input name="seasonFee" type="number" step="1" min="0" className="input w-28 py-1.5" defaultValue={(currentFeeCents / 100).toFixed(0)} />
      </div>
      <button type="submit" className="btn-secondary py-1.5 text-sm">Update fee</button>
    </form>
  );
}

export function DeleteSeasonButton({ seasonId, ticket, disabled }: { seasonId: string; ticket: string; disabled: boolean }) {
  if (disabled) return null;
  return (
    <form method="POST" action="/api/console/setup" onSubmit={(e) => { if (!confirm("Delete this season and its divisions?")) e.preventDefault(); }}>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="deleteSeason" />
      <input type="hidden" name="seasonId" value={seasonId} />
      <button className="text-xs text-rose-600 hover:underline">Delete season</button>
    </form>
  );
}

export function EditableDivision({
  ticket,
  division,
}: {
  ticket: string;
  division: { id: string; name: string; divisionType: string; minRating: number | null; maxRating: number | null; registrations: number };
}) {
  const [edit, setEdit] = useState(false);
  const [type, setType] = useState(division.divisionType);

  if (!edit) {
    return (
      <li className="flex items-center justify-between px-3 py-2 text-sm">
        <span>
          {division.name}
          {division.minRating != null && (
            <span className="ml-2 text-xs text-slate-400">
              {division.minRating}{division.maxRating != null ? `–${division.maxRating}` : "+"}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{division.registrations} reg.</span>
          <button onClick={() => setEdit(true)} className="text-xs text-brand-700 hover:underline">Edit</button>
          {division.registrations === 0 && <DeleteDivisionButton divisionId={division.id} ticket={ticket} />}
        </span>
      </li>
    );
  }

  return (
    <li className="px-3 py-2">
      <form method="POST" action="/api/console/setup" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="editDivision" />
        <input type="hidden" name="divisionId" value={division.id} />
        <div>
          <label className="label text-xs">Name</label>
          <input name="name" className="input py-1.5" defaultValue={division.name} required />
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
            <div className="w-20"><label className="label text-xs">Min</label><input name="minRating" type="number" step="0.1" className="input py-1.5" defaultValue={division.minRating ?? ""} /></div>
            <div className="w-20"><label className="label text-xs">Max</label><input name="maxRating" type="number" step="0.1" className="input py-1.5" defaultValue={division.maxRating ?? ""} /></div>
          </>
        )}
        <button type="submit" className="btn-primary py-1.5 text-sm">Save</button>
        <button type="button" onClick={() => setEdit(false)} className="btn-ghost py-1.5 text-sm">Cancel</button>
      </form>
    </li>
  );
}

export function ActivateButton({ seasonId, ticket }: { seasonId: string; ticket: string }) {
  return (
    <form method="POST" action="/api/console/setup">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="activateSeason" />
      <input type="hidden" name="seasonId" value={seasonId} />
      <button className="btn-ghost text-xs">Make active</button>
    </form>
  );
}

export function StandardDivisionsButton({ seasonId, ticket }: { seasonId: string; ticket: string }) {
  return (
    <form method="POST" action="/api/console/setup">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="addStandardDivisions" />
      <input type="hidden" name="seasonId" value={seasonId} />
      <button className="btn-secondary text-xs">+ Add standard divisions</button>
    </form>
  );
}

export function DeleteDivisionButton({ divisionId, ticket }: { divisionId: string; ticket: string }) {
  return (
    <form
      method="POST"
      action="/api/console/setup"
      onSubmit={(e) => { if (!confirm("Remove this division? This can't be undone.")) e.preventDefault(); }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="deleteDivision" />
      <input type="hidden" name="divisionId" value={divisionId} />
      <button className="text-xs text-rose-600 hover:underline">Remove</button>
    </form>
  );
}

export function AddDivisionForm({ seasonId, ticket }: { seasonId: string; ticket: string }) {
  const [type, setType] = useState("DUPR_BAND");
  return (
    <form method="POST" action="/api/console/setup" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="addDivision" />
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
