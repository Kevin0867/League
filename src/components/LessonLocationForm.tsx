"use client";

import { useState } from "react";
import { TimeSelect } from "@/components/TimeSelect";

// Add/edit a lesson location (a facility flagged for private/group lessons):
// name, area, court count, the court contact PURE emails to reserve, and the
// weekly hours the venue has courts open for lessons. Native POST.

type Hour = { day: string; start: string; end: string; courts: number };
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function LessonLocationForm({
  ticket, facility,
}: {
  ticket: string;
  facility?: {
    id: string; name: string; generalArea: string | null; courtCount: number;
    primaryContact: string | null; contactEmail: string | null; contactPhone: string | null;
    hours: Hour[];
  };
}) {
  const [hours, setHours] = useState<Hour[]>(facility?.hours.length ? facility.hours : [{ day: "MON", start: "", end: "", courts: 1 }]);

  return (
    <form method="POST" action="/api/console/lesson-locations" className="space-y-3">
      <input type="hidden" name="ticket" value={ticket} />
      {facility && <input type="hidden" name="facilityId" value={facility.id} />}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3"><label className="label">Location name</label><input name="name" defaultValue={facility?.name ?? ""} required placeholder="Red Mountain Ranch Country Club" className="input py-1" /></div>
        <div className="sm:col-span-2"><label className="label">Area (public)</label><input name="generalArea" defaultValue={facility?.generalArea ?? ""} placeholder="East Mesa" className="input py-1" /></div>
        <div className="sm:col-span-1"><label className="label">Courts</label><input name="courtCount" type="number" min={1} defaultValue={facility?.courtCount || 1} className="input py-1" /></div>

        <div className="sm:col-span-6"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Court contact — who PURE emails to reserve a court</p></div>
        <div className="sm:col-span-2"><label className="label">Contact name</label><input name="primaryContact" defaultValue={facility?.primaryContact ?? ""} className="input py-1" /></div>
        <div className="sm:col-span-2"><label className="label">Contact email</label><input name="contactEmail" type="email" defaultValue={facility?.contactEmail ?? ""} placeholder="pro@venue.com" className="input py-1" /></div>
        <div className="sm:col-span-2"><label className="label">Contact phone</label><input name="contactPhone" defaultValue={facility?.contactPhone ?? ""} className="input py-1" /></div>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700">Court hours for lessons (weekly)</p>
        <p className="mb-2 text-xs text-slate-500">Lessons are only offered inside these windows. Leave a day out to make it unavailable.</p>
        <div className="space-y-2">
          {hours.map((h, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Day</label>
                <select value={h.day} onChange={(e) => setHours((hs) => hs.map((x, j) => j === i ? { ...x, day: e.target.value } : x))} name="availDay" className="input py-1">
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div><label className="label">From</label><TimeSelect name="availStart" defaultValue={h.start} className="input py-1" /></div>
              <div><label className="label">To</label><TimeSelect name="availEnd" defaultValue={h.end} className="input py-1" /></div>
              <div><label className="label">Courts</label><input name="availCourts" type="number" min={1} defaultValue={h.courts || 1} className="input py-1 w-20" /></div>
              {hours.length > 1 && <button type="button" onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))} className="btn-chip-danger mb-1">remove</button>}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setHours((hs) => [...hs, { day: "MON", start: "", end: "", courts: 1 }])} className="btn-secondary mt-2 text-sm">+ Add hours</button>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-primary py-1 text-sm">{facility ? "Save location" : "Add location"}</button>
      </div>
    </form>
  );
}
