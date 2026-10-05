"use client";

import { useState } from "react";
import { formatDate, formatTime12 } from "@/lib/time";

// "What players see" — a coach/admin picks an offering + location and sees the
// exact open times a player would be offered (the same engine the booking page
// uses). Explains why times can be fewer than the coach's availability: a slot
// only shows when the coach is free AND the venue is open AND a court is free.

type Offering = { id: string; title: string | null; type: string; lengthMin: number | null };
type Facility = { id: string; name: string };
type DaySlots = { day: string; times: string[] };

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private", SEMI_PRIVATE: "Semi-private", GROUP: "Group" };

export function LessonSlotPreview({ coachPersonId, offerings, facilities }: { coachPersonId: string; offerings: Offering[]; facilities: Facility[] }) {
  const [offeringId, setOfferingId] = useState("");
  const [loc, setLoc] = useState("");
  const [slots, setSlots] = useState<DaySlots[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!offeringId || !loc) return;
    setLoading(true); setSlots(null);
    try {
      const res = await fetch(`/api/lessons/slots?coach=${encodeURIComponent(coachPersonId)}&offering=${encodeURIComponent(offeringId)}&loc=${encodeURIComponent(loc)}`);
      const data = (await res.json().catch(() => ({}))) as { slots?: DaySlots[] };
      setSlots(data.slots ?? []);
    } catch { setSlots([]); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">A time only appears to players when <strong>you&apos;re available</strong>, the <strong>venue is open</strong>, and a <strong>court is free</strong> — so this can be fewer times than your availability. Preview any offering + location:</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Offering</label>
          <select value={offeringId} onChange={(e) => { setOfferingId(e.target.value); setSlots(null); }} className="input py-1">
            <option value="">—</option>
            {offerings.map((o) => <option key={o.id} value={o.id}>{o.title || TYPE_LABEL[o.type]} · {o.lengthMin ?? 60} min</option>)}
          </select>
        </div>
        <div>
          <label className="label">Location</label>
          <select value={loc} onChange={(e) => { setLoc(e.target.value); setSlots(null); }} className="input py-1">
            <option value="">—</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <button type="button" onClick={run} disabled={!offeringId || !loc || loading} className="btn-secondary disabled:opacity-40">{loading ? "Checking…" : "Preview"}</button>
      </div>

      {slots && (slots.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">No open times at this location in the next 6 weeks. Usually this means the venue isn&apos;t open during your availability, or courts are already booked. Try another location or widen your availability.</p>
      ) : (
        <div className="space-y-1.5">
          {slots.map(({ day, times }) => (
            <div key={day} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="w-40 shrink-0 font-medium text-slate-700">{formatDate(new Date(`${day}T12:00:00Z`))}</span>
              <span className="flex flex-wrap gap-1.5">
                {times.map((t) => <span key={t} className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{formatTime12(t)}</span>)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
