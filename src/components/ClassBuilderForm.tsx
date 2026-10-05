"use client";

import { useState } from "react";

// Build or edit a class/clinic: the standard details (title, price, capacity,
// venue, coach, description) plus two class-specific sections shown only for a
// public CLINIC — audience targeting (DUPR band, gender, age group) and an
// optional multi-week schedule (a repeater of session date/times). A single
// clinic keeps the lone date field; flipping "multi-week" reveals the repeater.

type Facility = { id: string; name: string };
type Coach = { id: string; name: string };
type ClassOffering = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  facilityId: string | null;
  coachId: string | null;
  priceCents: number;
  capacity: number | null;
  scheduledAt: string | null; // datetime-local value
  targetMinRating: number | null;
  targetMaxRating: number | null;
  targetGender: string | null;
  targetAgeGroup: string | null;
  sessions: string[]; // datetime-local values, earliest first
};

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private", SEMI_PRIVATE: "Semi-private", CLINIC: "Clinic / Class" };

export function ClassBuilderForm({
  ticket, facilities, coaches, offering,
}: {
  ticket: string;
  facilities: Facility[];
  coaches: Coach[];
  offering?: ClassOffering;
}) {
  const editing = !!offering;
  const [type, setType] = useState(offering?.type ?? "CLINIC");
  const [multi, setMulti] = useState((offering?.sessions.length ?? 0) > 1);
  const [sessions, setSessions] = useState<string[]>(
    offering?.sessions.length ? offering.sessions : [""]
  );
  const isClinic = type === "CLINIC";

  const setSession = (i: number, v: string) => setSessions((s) => s.map((x, j) => (j === i ? v : x)));
  const addSession = () => setSessions((s) => [...s, ""]);
  const removeSession = (i: number) => setSessions((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : s));

  return (
    <form method="POST" action="/api/console/alacarte" className="grid gap-3 sm:grid-cols-6 sm:items-end">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={editing ? "editClass" : "createOffering"} />
      {editing && <input type="hidden" name="offeringId" value={offering!.id} />}

      <div className="sm:col-span-3">
        <label className="label">Title</label>
        <input name="title" className="input" placeholder="4.0 Men's Saturday class" defaultValue={offering?.title ?? ""} required />
      </div>
      <div className="sm:col-span-1">
        <label className="label">Type</label>
        <select name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="sm:col-span-1">
        <label className="label">Price / person ($)</label>
        <input name="price" type="number" min={0} step="0.01" className="input" placeholder="75" defaultValue={offering ? (offering.priceCents / 100).toString() : ""} required={!editing} />
      </div>
      <div className="sm:col-span-1">
        <label className="label">Capacity</label>
        <input name="capacity" type="number" min={1} step="1" className="input" placeholder="8" defaultValue={offering?.capacity ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Venue</label>
        <select name="facilityId" className="input" defaultValue={offering?.facilityId ?? ""} required>
          <option value="">—</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Coach</label>
        <select name="coachId" className="input" defaultValue={offering?.coachId ?? ""}>
          <option value="">Any / TBD</option>
          {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Schedule: single date, or a multi-week repeater */}
      {!isClinic || !multi ? (
        <div className="sm:col-span-2">
          <label className="label">Date &amp; time</label>
          <input name="scheduledAt" type="datetime-local" className="input" defaultValue={offering && !multi ? (offering.scheduledAt ?? "") : ""} />
        </div>
      ) : (
        <div className="sm:col-span-6 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly class sessions</p>
          <div className="space-y-2">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 text-xs text-slate-400">Week {i + 1}</span>
                <input name="sessionAt" type="datetime-local" className="input flex-1" value={s} onChange={(e) => setSession(i, e.target.value)} />
                {sessions.length > 1 && (
                  <button type="button" onClick={() => removeSession(i)} className="text-xs font-medium text-rose-600 hover:underline">remove</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addSession} className="btn-chip-muted mt-2 text-xs font-semibold">+ Add a session</button>
        </div>
      )}

      {isClinic && (
        <label className="sm:col-span-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Multi-week class (several dated sessions, one sign-up covers them all)
        </label>
      )}

      {/* Targeting — only meaningful for a public clinic/class */}
      {isClinic && (
        <div className="sm:col-span-6 rounded-lg border border-slate-200 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Who it&apos;s for (optional targeting)</p>
          <p className="mb-3 text-xs text-slate-400">Used to label the class and to find matching players to invite. Leave blank for open-to-all.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Min DUPR</span>
              <input name="targetMinRating" type="number" min={1} max={8} step="0.25" className="input" placeholder="3.5" defaultValue={offering?.targetMinRating ?? ""} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Max DUPR</span>
              <input name="targetMaxRating" type="number" min={1} max={8} step="0.25" className="input" placeholder="4.0" defaultValue={offering?.targetMaxRating ?? ""} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Gender</span>
              <select name="targetGender" className="input" defaultValue={offering?.targetGender ?? ""}>
                <option value="">Open</option>
                <option value="MALE">Men</option>
                <option value="FEMALE">Women</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Age group</span>
              <select name="targetAgeGroup" className="input" defaultValue={offering?.targetAgeGroup ?? ""}>
                <option value="">Any</option>
                <option value="YOUTH">Youth (under 18)</option>
                <option value="ADULT">Adults (18+)</option>
              </select>
            </label>
          </div>
        </div>
      )}

      <div className="sm:col-span-6">
        <label className="label">Description <span className="font-normal text-slate-400">(shown on the public signup page)</span></label>
        <textarea name="description" rows={2} className="input" placeholder="What to expect, who it's for, what to bring…" defaultValue={offering?.description ?? ""} />
      </div>

      <button className="btn-primary sm:col-span-2">{editing ? "Save changes" : "Add offering"}</button>
    </form>
  );
}
