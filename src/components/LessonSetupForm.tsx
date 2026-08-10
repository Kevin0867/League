"use client";

import { useState } from "react";

type Opt = { id: string; name: string };
type Participant = { firstName: string; lastName: string; email: string; phone: string };

const EMPTY: Participant = { firstName: "", lastName: "", email: "", phone: "" };

// Admin-arranged private / semi-private / group lesson: capture the class
// details + one or more participants, then send each a payment-request email.
export function LessonSetupForm({
  ticket,
  facilities,
  coaches,
}: {
  ticket: string;
  facilities: Opt[];
  coaches: Opt[];
}) {
  const [people, setPeople] = useState<Participant[]>([{ ...EMPTY }]);
  const set = (i: number, k: keyof Participant, v: string) =>
    setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  return (
    <form method="POST" action="/api/console/alacarte" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="setupLesson" />

      <div>
        <h2 className="font-semibold text-slate-900">Set up a lesson &amp; send payment request</h2>
        <p className="text-sm text-slate-500">
          Add the class details and participants. Each person gets an email with the details and a button to pay
          and secure their spot. These stay internal — they don&apos;t appear on the public Clinics page.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <label className="label">Class title</label>
          <input name="title" className="input" placeholder="60-min private lesson" required />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Type</label>
          <select name="type" className="input">
            <option value="PRIVATE">Private</option>
            <option value="SEMI_PRIVATE">Semi-private</option>
            <option value="CLINIC">Group</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Price / person ($)</label>
          <input name="price" type="number" min={0} step="0.01" className="input" placeholder="90" required />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Location</label>
          <select name="facilityId" className="input" required>
            <option value="">—</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Coach</label>
          <select name="coachId" className="input">
            <option value="">TBD</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Date &amp; time</label>
          <input name="scheduledAt" type="datetime-local" className="input" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Participants</div>
        {people.map((p, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-9 sm:items-end rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
            <div className="sm:col-span-2">
              <label className="label">First name</label>
              <input value={p.firstName} onChange={(e) => set(i, "firstName", e.target.value)} name="pFirst" className="input" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Last name</label>
              <input value={p.lastName} onChange={(e) => set(i, "lastName", e.target.value)} name="pLast" className="input" required />
            </div>
            <div className="sm:col-span-3">
              <label className="label">Email</label>
              <input value={p.email} onChange={(e) => set(i, "email", e.target.value)} name="pEmail" type="email" className="input" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Phone <span className="font-normal text-slate-400">(opt.)</span></label>
              <div className="flex items-end gap-2">
                <input value={p.phone} onChange={(e) => set(i, "phone", e.target.value)} name="pPhone" type="tel" className="input" />
                {people.length > 1 && (
                  <button type="button" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}
                    className="mb-1 shrink-0 text-xs text-rose-600 hover:underline">remove</button>
                )}
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setPeople((ps) => [...ps, { ...EMPTY }])} className="btn-secondary text-sm">
          + Add participant
        </button>
      </div>

      <button className="btn-primary">Create lesson &amp; send payment request{people.length > 1 ? "s" : ""}</button>
    </form>
  );
}
