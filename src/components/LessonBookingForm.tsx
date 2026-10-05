"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12 } from "@/lib/time";

// Steps 3–4 of the public booking flow (pick a time, players, optional
// recurrence, contact) as a client component, so the price shown on the button
// updates live with the number of players and the recurring discount — and the
// recurrence end fields show only the one that's relevant.

type DaySlots = { day: string; times: string[] };

export function LessonBookingForm({
  coachPersonId, offeringId, facilityId, slots,
  perPersonCents, discountPct, type, minPeople, maxPeople, recurrenceAllowed,
}: {
  coachPersonId: string;
  offeringId: string;
  facilityId: string;
  slots: DaySlots[];
  perPersonCents: number;
  discountPct: number;
  type: string;
  minPeople: number;
  maxPeople: number;
  recurrenceAllowed: boolean;
}) {
  const isGroup = type !== "PRIVATE" && maxPeople > 1;
  const [people, setPeople] = useState(isGroup ? minPeople : 1);
  const [recurring, setRecurring] = useState(false);
  const [endType, setEndType] = useState<"COUNT" | "UNTIL_DATE">("COUNT");

  const headcount = isGroup ? Math.min(Math.max(people, minPeople), maxPeople) : 1;
  const baseCents = perPersonCents * headcount;
  const perLessonCents = recurring && discountPct > 0 ? Math.round(baseCents * (1 - discountPct / 100)) : baseCents;

  return (
    <form method="POST" action="/api/lessons/book" className="mt-6 space-y-5">
      <input type="hidden" name="coachPersonId" value={coachPersonId} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="facilityId" value={facilityId} />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">3 · Pick a time</h2>
        <div className="mt-2 space-y-3">
          {slots.map(({ day, times }) => (
            <div key={day}>
              <p className="text-xs font-semibold text-slate-500">{formatDate(new Date(`${day}T12:00:00Z`))}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {times.map((t) => (
                  <label key={t} className="cursor-pointer">
                    <input type="radio" name="slot" value={`${day}|${t}`} required className="peer sr-only" />
                    <span className="inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 peer-checked:border-brand-500 peer-checked:bg-brand-600 peer-checked:text-white">{formatTime12(t)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isGroup && (
        <div>
          <label className="label">How many players?</label>
          <input name="people" type="number" min={minPeople} max={maxPeople} value={people} onChange={(e) => setPeople(Math.min(Math.max(parseInt(e.target.value || String(minPeople), 10), minPeople), maxPeople))} className="input w-28" />
          <p className="mt-1 text-xs text-slate-500">{formatCents(perPersonCents)} per person · {headcount} player{headcount === 1 ? "" : "s"} = <strong>{formatCents(baseCents)}</strong> per lesson.</p>
        </div>
      )}

      {recurrenceAllowed && (
        <details onToggle={(e) => setRecurring((e.target as HTMLDetailsElement).open)} className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Make this a recurring lesson</summary>
          <div className="mt-3 space-y-3">
            <input type="hidden" name="recurring" value="on" />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Repeats</label>
                <select name="cadence" className="input py-1"><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select>
              </div>
              <div>
                <label className="label">End</label>
                <select name="endType" value={endType} onChange={(e) => setEndType(e.target.value as "COUNT" | "UNTIL_DATE")} className="input py-1">
                  <option value="COUNT">After N lessons</option>
                  <option value="UNTIL_DATE">Until a date</option>
                </select>
              </div>
              {endType === "COUNT" ? (
                <div>
                  <label className="label"># of lessons</label>
                  <input name="count" type="number" min="2" max="52" defaultValue="5" className="input py-1 w-24" />
                </div>
              ) : (
                <div>
                  <label className="label">Until</label>
                  <input name="endDate" type="date" className="input py-1" />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">We book the same time each week/month where the coach and a court are free. You pay per lesson — the first now, the rest before each session.</p>
            {discountPct > 0 && <p className="text-xs font-semibold text-emerald-700">Recurring saves {discountPct}% off each lesson — {formatCents(perLessonCents)} per lesson instead of {formatCents(baseCents)}.</p>}
          </div>
        </details>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">4 · Your details</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div><label className="label">First name</label><input name="firstName" required className="input" /></div>
          <div><label className="label">Last name</label><input name="lastName" required className="input" /></div>
          <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
          <div><label className="label">Mobile</label><input name="phone" type="tel" className="input" /></div>
        </div>
      </div>

      <button type="submit" className="w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white hover:bg-brand-700">
        Continue to payment — {formatCents(perLessonCents)}{isGroup ? " total" : ""}
      </button>
      <p className="text-center text-xs text-slate-400">
        You&apos;ll pay for your first lesson on the next screen{isGroup ? ` (${formatCents(perPersonCents)}/person × ${headcount})` : ""}
        {recurring && discountPct > 0 ? `, with ${discountPct}% off for the recurring series` : ""}. Your court is reserved the moment you book.
      </p>
    </form>
  );
}
