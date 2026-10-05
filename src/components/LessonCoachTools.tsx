"use client";

import { useState } from "react";

// Coach-side booking tools: book a lesson for a walk-up/phone client, and block
// off personal time so players can't book it. Native-form friendly but wrapped
// as a client component so the two tools can live behind their own disclosures
// and show a running "blocked times" list without a full nav item.

type Offering = { id: string; title: string; type: string; minPeople: number | null; maxPeople: number | null };
type Facility = { id: string; name: string };
type BlockEx = { id: string; label: string };

export function LessonCoachTools({
  offerings, facilities, blocks, ticket, returnTo,
}: {
  offerings: Offering[];
  facilities: Facility[];
  blocks: BlockEx[];
  ticket: string;
  returnTo: string;
}) {
  const [noCharge, setNoCharge] = useState(false);
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  const sel = offerings.find((o) => o.id === offeringId) ?? offerings[0];
  const minP = sel?.minPeople ?? 1;
  const maxP = sel?.maxPeople ?? 1;

  return (
    <div className="space-y-4">
      {/* Book a client */}
      <details className="card">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
          + Book a lesson for a client
          <span className="ml-2 font-normal text-slate-400">walk-up or phone booking</span>
        </summary>
        {offerings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Add a bookable offering first (set a price and mark it active), then you can book clients here.</p>
        ) : (
          <form method="POST" action="/api/console/lessons" className="mt-4 space-y-3">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="coachBook" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Lesson</span>
                <select name="offeringId" required className="input w-full" value={offeringId} onChange={(e) => setOfferingId(e.target.value)}>
                  {offerings.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Location</span>
                <select name="facilityId" required className="input w-full">
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              {maxP > 1 && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Players <span className="text-slate-400">({minP}–{maxP})</span></span>
                  <input type="number" name="people" min={minP} max={maxP} defaultValue={minP} className="input w-full" />
                </label>
              )}
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Date</span>
                <input type="date" name="day" required className="input w-full" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Start time</span>
                <input type="time" name="time" required step={900} className="input w-full" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Client first name</span>
                <input name="firstName" required className="input w-full" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Client last name</span>
                <input name="lastName" required className="input w-full" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Client email</span>
                <input type="email" name="email" required className="input w-full" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Client phone <span className="text-slate-400">(optional)</span></span>
                <input name="phone" className="input w-full" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="noCharge" value="1" checked={noCharge} onChange={(e) => setNoCharge(e.target.checked)} />
              Don&apos;t charge — mark this lesson as comped / already paid
            </label>
            <p className="text-xs text-slate-400">
              {noCharge
                ? "The lesson is booked and marked paid — no payment is collected."
                : "The lesson is booked and a pay link is created. You'll get the link to send to the client."}
            </p>
            <button type="submit" className="btn-primary">Book lesson</button>
          </form>
        )}
      </details>

      {/* Block off time */}
      <details className="card">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
          + Block off time
          <span className="ml-2 font-normal text-slate-400">lunch, travel, personal</span>
        </summary>
        <form method="POST" action="/api/console/lessons" className="mt-4 space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="blockTime" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Date</span>
              <input type="date" name="day" required className="input w-full" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">From <span className="text-slate-400">(blank = all day)</span></span>
              <input type="time" name="startTime" step={900} className="input w-full" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">To</span>
              <input type="time" name="endTime" step={900} className="input w-full" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Note <span className="text-slate-400">(optional)</span></span>
            <input name="note" placeholder="e.g. Lunch, out of town" className="input w-full" />
          </label>
          <button type="submit" className="btn-primary">Block this time</button>
        </form>

        {blocks.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming blocks</p>
            <ul className="space-y-1.5">
              {blocks.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                  <span>{b.label}</span>
                  <form method="POST" action="/api/console/lessons">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="unblock" />
                    <input type="hidden" name="exceptionId" value={b.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button type="submit" className="text-xs font-medium text-rose-600 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
}
