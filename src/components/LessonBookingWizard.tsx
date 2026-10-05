"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12 } from "@/lib/time";
import { perPersonCentsFor, type PriceTier } from "@/lib/domain/lessonPricing";

// The whole public booking flow as a single client component: choose offering →
// location → time → players/recurrence → details. Selection is in-component state
// (no page reload or scroll jump), slots load from /api/lessons/slots, and the
// price on the button updates live with players + the recurring discount. For a
// group, each additional player's name/email is collected for the roster/waivers.

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private (1 player)", SEMI_PRIVATE: "Semi-private (2–3)", GROUP: "Group (4+)" };
const DEFAULTS: Record<string, { min: number; max: number }> = { PRIVATE: { min: 1, max: 1 }, SEMI_PRIVATE: { min: 2, max: 3 }, GROUP: { min: 4, max: 8 } };

type Offering = {
  id: string; type: string; title: string | null; priceCents: number; adminLockedPriceCents: number | null;
  lengthMin: number | null; minPeople: number | null; maxPeople: number | null; recurrenceAllowed: boolean;
  recurringDiscountPct: number | null; preferredFacilityIds: string[];
  priceTiers: PriceTier[]; introPriceCents: number | null;
};
type Facility = { id: string; name: string; generalArea: string | null };
type DaySlots = { day: string; times: string[] };

export function LessonBookingWizard({
  coachPersonId, offerings, facilities, initialError,
}: {
  coachPersonId: string;
  offerings: Offering[];
  facilities: Facility[];
  initialError?: string | null;
}) {
  const facName = new Map(facilities.map((f) => [f.id, f.name]));
  const [offeringId, setOfferingId] = useState<string>("");
  const [loc, setLoc] = useState<string>("");
  const [slots, setSlots] = useState<DaySlots[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [people, setPeople] = useState(1);
  const [recurring, setRecurring] = useState(false);
  const [endType, setEndType] = useState<"COUNT" | "UNTIL_DATE">("COUNT");

  const offering = offerings.find((o) => o.id === offeringId) ?? null;
  const flatPerPerson = offering ? (offering.adminLockedPriceCents ?? offering.priceCents) : 0;
  const discountPct = offering?.recurrenceAllowed && offering.recurringDiscountPct ? Math.min(90, Math.max(0, offering.recurringDiscountPct)) : 0;
  const minPeople = offering ? (offering.minPeople ?? DEFAULTS[offering.type]?.min ?? 1) : 1;
  const maxPeople = offering ? (offering.maxPeople ?? DEFAULTS[offering.type]?.max ?? 1) : 1;
  const isGroup = !!offering && offering.type !== "PRIVATE" && maxPeople > 1;

  const locOptions = offering
    ? (offering.preferredFacilityIds.length ? facilities.filter((f) => offering.preferredFacilityIds.includes(f.id)) : facilities)
    : [];

  const chooseOffering = (id: string) => {
    setOfferingId(id); setLoc(""); setSlots(null);
    const o = offerings.find((x) => x.id === id);
    const mn = o ? (o.minPeople ?? DEFAULTS[o.type]?.min ?? 1) : 1;
    setPeople(o && o.type !== "PRIVATE" ? mn : 1);
    setRecurring(false);
  };

  const chooseLocation = async (fid: string) => {
    setLoc(fid); setSlots(null); setLoadingSlots(true);
    try {
      const res = await fetch(`/api/lessons/slots?coach=${encodeURIComponent(coachPersonId)}&offering=${encodeURIComponent(offeringId)}&loc=${encodeURIComponent(fid)}`);
      const data = (await res.json().catch(() => ({}))) as { slots?: DaySlots[] };
      setSlots(data.slots ?? []);
    } catch { setSlots([]); } finally { setLoadingSlots(false); }
  };

  const headcount = isGroup ? Math.min(Math.max(people, minPeople), maxPeople) : 1;
  const perPerson = offering ? perPersonCentsFor(offering.priceTiers, flatPerPerson, headcount) : 0;
  const baseCents = perPerson * headcount;
  const perLessonCents = recurring && discountPct > 0 ? Math.round(baseCents * (1 - discountPct / 100)) : baseCents;
  const introCents = offering?.introPriceCents ?? null; // new-player first-lesson price
  const extraPlayers = Math.max(0, headcount - 1); // booker is player 1

  return (
    <div>
      {initialError && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{initialError}</p>}

      {/* Step 1 — choose the lesson */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">1 · Choose your lesson</h2>
        <div className="mt-2 grid gap-2">
          {offerings.map((o) => {
            const flat = o.adminLockedPriceCents ?? o.priceCents;
            const lowest = o.priceTiers.length ? Math.min(flat, ...o.priceTiers.map((t) => t.perPersonCents)) : flat;
            const hasRange = o.priceTiers.length > 0 && lowest !== flat;
            const selected = offeringId === o.id;
            const prefNames = (o.preferredFacilityIds.length ? o.preferredFacilityIds : facilities.map((f) => f.id)).map((fid) => facName.get(fid)).filter(Boolean);
            const sizeLabel = o.type === "PRIVATE" ? "1 player" : `${o.minPeople ?? 2}–${o.maxPeople ?? o.minPeople ?? 2} players`;
            return (
              <button type="button" key={o.id} onClick={() => chooseOffering(o.id)} className={`flex items-center justify-between rounded-xl border p-3 text-left ${selected ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"}`}>
                <span>
                  <span className="font-semibold text-slate-900">{o.title || TYPE_LABEL[o.type]}</span>
                  <span className="ml-2 text-xs text-slate-500">{TYPE_LABEL[o.type]} · {o.lengthMin ?? 60} min · {sizeLabel}{o.recurrenceAllowed ? " · can repeat weekly/monthly" : ""}{o.recurringDiscountPct && o.recurrenceAllowed ? ` (${o.recurringDiscountPct}% off)` : ""}</span>
                  {prefNames.length > 0 && <span className="mt-0.5 block text-[11px] text-slate-400">At: {prefNames.join(", ")}</span>}
                  {o.introPriceCents != null && <span className="mt-0.5 block text-[11px] font-semibold text-emerald-700">New players: {formatCents(o.introPriceCents)} first lesson</span>}
                </span>
                <span className="text-right"><span className="font-bold text-brand-700">{hasRange ? "from " : ""}{formatCents(lowest)}</span><span className="block text-[11px] font-normal text-slate-400">per person</span></span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2 — choose a location */}
      {offering && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">2 · Choose a location</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {locOptions.map((f) => (
              <button type="button" key={f.id} onClick={() => chooseLocation(f.id)} className={`rounded-xl border px-3 py-2 text-sm ${loc === f.id ? "border-brand-500 bg-brand-50 font-semibold text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"}`}>
                {f.name}{f.generalArea ? <span className="ml-1 text-xs text-slate-400">· {f.generalArea}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Steps 3–4 — time, players, recurrence, details */}
      {offering && loc && (
        loadingSlots ? (
          <p className="mt-6 text-sm text-slate-400">Finding open times…</p>
        ) : slots && slots.length === 0 ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No open times at {facName.get(loc)} in the next few weeks. Try another location, or check back soon.</p>
        ) : slots ? (
          <form method="POST" action="/api/lessons/book" className="mt-6 space-y-5">
            <input type="hidden" name="coachPersonId" value={coachPersonId} />
            <input type="hidden" name="offeringId" value={offering.id} />
            <input type="hidden" name="facilityId" value={loc} />

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
                <p className="mt-1 text-xs text-slate-500">{formatCents(perPerson)} per person · {headcount} player{headcount === 1 ? "" : "s"} = <strong>{formatCents(baseCents)}</strong> per lesson.</p>
              </div>
            )}

            {offering.recurrenceAllowed && (
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
                      <div><label className="label"># of lessons</label><input name="count" type="number" min="2" max="52" defaultValue="5" className="input py-1 w-24" /></div>
                    ) : (
                      <div><label className="label">Until</label><input name="endDate" type="date" className="input py-1" /></div>
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
              {extraPlayers > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-slate-700">The other {extraPlayers} player{extraPlayers === 1 ? "" : "s"}</p>
                  <p className="text-xs text-slate-500">So we can send everyone their waiver and track the roster.</p>
                  <div className="mt-2 space-y-2">
                    {Array.from({ length: extraPlayers }).map((_, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-2">
                        <input name="rosterName" placeholder={`Player ${i + 2} name`} className="input" />
                        <input name="rosterEmail" type="email" placeholder={`Player ${i + 2} email`} className="input" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {introCents != null && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">
                New to PURE? Your <strong>first lesson is {formatCents(introCents)}</strong> — applied automatically at checkout if this is your first lesson with us.
              </p>
            )}
            <button type="submit" className="w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white hover:bg-brand-700">
              Continue to payment — {formatCents(perLessonCents)}{isGroup ? " total" : ""}
            </button>
            <p className="text-center text-xs text-slate-400">
              You&apos;ll pay for your first lesson on the next screen{isGroup ? ` (${formatCents(perPerson)}/person × ${headcount})` : ""}
              {recurring && discountPct > 0 ? `, with ${discountPct}% off for the recurring series` : ""}. Your court is reserved the moment you book.
            </p>
          </form>
        ) : null
      )}
    </div>
  );
}
