"use client";

import { useState } from "react";

// Add/edit one coach lesson offering. Client-side so the form guides valid input
// (format drives sensible group-size defaults and locks a private lesson to 1
// player; the recurring discount is only editable when recurrence is on) — the
// server still validates and rejects bad values. Native POST, no fetch.

type Offering = {
  id: string; type: string; title: string; description: string | null; priceCents: number;
  lengthMin: number | null; minPeople: number | null; maxPeople: number | null;
  preferredFacilityIds: unknown; recurrenceAllowed: boolean; recurringDiscountPct: number | null; active: boolean;
  priceTiers?: unknown; introPriceCents?: number | null;
  additionalPersonDiscountPct?: number | null; packages?: unknown;
  minNoticeHours?: number | null; bookingHorizonDays?: number | null; bufferMin?: number | null; dailyCap?: number | null; cancelWindowHours?: number | null; cancelPolicy?: string | null;
};

type Tier = { people: string; price: string };
function initialTiers(v: unknown): Tier[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => { const o = x as { people?: unknown; perPersonCents?: unknown }; return { people: String(Number(o.people) || ""), price: Number.isFinite(Number(o.perPersonCents)) ? (Number(o.perPersonCents) / 100).toFixed(2) : "" }; }).filter((t) => t.people);
}
type Pkg = { count: string; pct: string };
function initialPackages(v: unknown): Pkg[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => { const o = x as { count?: unknown; discountPct?: unknown }; return { count: String(Number(o.count) || ""), pct: String(Number(o.discountPct) || "") }; }).filter((p) => p.count);
}

const TYPE_OPTIONS: Array<[string, string]> = [
  ["PRIVATE", "Private (1 player)"],
  ["SEMI_PRIVATE", "Semi-private (2–3)"],
  ["GROUP", "Group (4+)"],
];
// Sensible min/max filled in when the format changes.
const DEFAULTS: Record<string, { min: number; max: number }> = {
  PRIVATE: { min: 1, max: 1 },
  SEMI_PRIVATE: { min: 2, max: 3 },
  GROUP: { min: 4, max: 8 },
};

function asIds(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }

export function OfferingForm({
  ticket, personId, offering, facilities,
}: {
  ticket: string;
  personId?: string;
  offering?: Offering;
  facilities: { id: string; name: string }[];
}) {
  const [type, setType] = useState(offering?.type ?? "PRIVATE");
  const [minPeople, setMinPeople] = useState(offering?.minPeople ?? DEFAULTS[offering?.type ?? "PRIVATE"]?.min ?? 1);
  const [maxPeople, setMaxPeople] = useState(offering?.maxPeople ?? DEFAULTS[offering?.type ?? "PRIVATE"]?.max ?? 1);
  const [recurrence, setRecurrence] = useState(offering ? offering.recurrenceAllowed : true);
  const [tiers, setTiers] = useState<Tier[]>(initialTiers(offering?.priceTiers));
  const [packages, setPackages] = useState<Pkg[]>(initialPackages(offering?.packages));
  const [confirmDel, setConfirmDel] = useState(false);
  const pref = asIds(offering?.preferredFacilityIds);
  const isPrivate = type === "PRIVATE";

  const onType = (t: string) => {
    setType(t);
    const d = DEFAULTS[t];
    if (d) { setMinPeople(d.min); setMaxPeople(d.max); }
  };

  return (
    <div className="space-y-3">
      <form method="POST" action="/api/console/lesson-offerings" className="grid gap-3 sm:grid-cols-6">
        <input type="hidden" name="ticket" value={ticket} />
        {personId && <input type="hidden" name="personId" value={personId} />}
        <input type="hidden" name="op" value="saveOffering" />
        {offering && <input type="hidden" name="offeringId" value={offering.id} />}

        <div className="sm:col-span-2">
          <label className="label">Format</label>
          <select name="type" value={type} onChange={(e) => onType(e.target.value)} className="input py-1">
            {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className="label">Length (min)</label>
          <input name="lengthMin" type="number" min={15} max={240} step={15} defaultValue={offering?.lengthMin ?? 60} className="input py-1" />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Price / person ($)</label>
          <input name="price" type="number" min={0} step="0.01" defaultValue={offering ? (offering.priceCents / 100).toFixed(2) : ""} placeholder="80.00" className="input py-1" required />
        </div>
        <div className="sm:col-span-1">
          <label className="label"># people (min)</label>
          <input name="minPeople" type="number" min={1} max={20} value={isPrivate ? 1 : minPeople} onChange={(e) => setMinPeople(Math.max(1, parseInt(e.target.value || "1", 10)))} disabled={isPrivate} className="input py-1 disabled:bg-slate-100 disabled:text-slate-400" />
        </div>
        <div className="sm:col-span-1">
          <label className="label"># people (max)</label>
          <input name="maxPeople" type="number" min={1} max={20} value={isPrivate ? 1 : maxPeople} onChange={(e) => setMaxPeople(Math.max(1, parseInt(e.target.value || "1", 10)))} disabled={isPrivate} className="input py-1 disabled:bg-slate-100 disabled:text-slate-400" />
        </div>

        <div className="sm:col-span-6">
          <label className="label">Title / note (optional)</label>
          <input name="title" defaultValue={offering?.title ?? ""} placeholder="e.g. 60-min private — all levels" className="input py-1" />
        </div>

        {facilities.length > 0 && (
          <div className="sm:col-span-6">
            <label className="label">Preferred locations</label>
            <div className="flex flex-wrap gap-3">
              {facilities.map((f) => (
                <label key={f.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="facility" value={f.id} defaultChecked={pref.includes(f.id)} /> {f.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <p className="sm:col-span-6 -mt-1 text-xs text-slate-500">
          <strong>Price is per person.</strong> For a semi-private or group lesson, each player pays this amount (e.g. $40/person × 3 players = $120 for the lesson).
        </p>

        {/* Optional per-person price by group size — overrides the flat price. */}
        {!isPrivate && (
          <div className="sm:col-span-6 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">Price by group size <span className="font-normal text-slate-400">(optional — overrides the per-person price above for a matching headcount)</span></p>
            <div className="mt-2 space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div><label className="label text-xs">Players</label><input name="tierPeople" type="number" min={1} max={20} value={t.people} onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, people: e.target.value } : x))} className="input py-1 w-24" /></div>
                  <div><label className="label text-xs">$ / person</label><input name="tierPrice" type="number" min={0} step="0.01" value={t.price} onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} className="input py-1 w-28" /></div>
                  <button type="button" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))} className="btn-chip-danger mb-1">remove</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setTiers((ts) => [...ts, { people: "", price: "" }])} className="btn-secondary mt-2 text-xs">+ Add a tier</button>
            <p className="mt-1 text-xs text-slate-400">e.g. 2 players → $60/person, 3 players → $50/person. Headcounts without a tier use the per-person price above.</p>
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="label">First-lesson intro price ($)</label>
          <input name="introPrice" type="number" min={0} step="0.01" defaultValue={offering?.introPriceCents != null ? (offering.introPriceCents / 100).toFixed(2) : ""} placeholder="optional" className="input py-1" />
        </div>
        <p className="sm:col-span-4 flex items-end text-xs text-slate-500">A discounted flat total for a brand-new player&apos;s very first lesson (a one-time intro offer). Leave blank for none.</p>

        {!isPrivate && (
          <div className="sm:col-span-2">
            <label className="label">Sibling/family discount (%)</label>
            <input name="additionalPersonDiscountPct" type="number" min={0} max={90} step={1} defaultValue={offering?.additionalPersonDiscountPct ?? ""} placeholder="optional" className="input py-1" />
          </div>
        )}
        {!isPrivate && <p className="sm:col-span-4 flex items-end text-xs text-slate-500">% off each player after the first when a family books together. (Ignored if you set per-group-size tiers above.)</p>}

        {/* Prepaid packages — book N lessons at a discount. */}
        <div className="sm:col-span-6 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-700">Lesson packages <span className="font-normal text-slate-400">(optional — book N lessons at a discount; shown as a recurring option)</span></p>
          <div className="mt-2 space-y-2">
            {packages.map((p, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div><label className="label text-xs"># lessons</label><input name="pkgCount" type="number" min={2} max={52} value={p.count} onChange={(e) => setPackages((ps) => ps.map((x, j) => j === i ? { ...x, count: e.target.value } : x))} className="input py-1 w-24" /></div>
                <div><label className="label text-xs">% off each</label><input name="pkgPct" type="number" min={0} max={90} value={p.pct} onChange={(e) => setPackages((ps) => ps.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} className="input py-1 w-24" /></div>
                <button type="button" onClick={() => setPackages((ps) => ps.filter((_, j) => j !== i))} className="btn-chip-danger mb-1">remove</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setPackages((ps) => [...ps, { count: "", pct: "" }])} className="btn-secondary mt-2 text-xs">+ Add a package</button>
          <p className="mt-1 text-xs text-slate-400">e.g. 5 lessons → 10% off each, 10 lessons → 15% off each. Players pay per lesson (first now, rest before each).</p>
        </div>

        <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="recurrenceAllowed" checked={recurrence} onChange={(e) => setRecurrence(e.target.checked)} /> Allow recurring bookings (weekly/monthly series)
        </label>
        <div className="sm:col-span-2">
          <label className="label">Recurring discount (%)</label>
          <input name="recurringDiscountPct" type="number" min={0} max={90} step={1} defaultValue={offering?.recurringDiscountPct ?? ""} placeholder="0" disabled={!recurrence} className="input py-1 disabled:bg-slate-100 disabled:text-slate-400" />
        </div>
        <div className="sm:col-span-1" />
        <p className="sm:col-span-6 -mt-1 text-xs text-slate-500">
          {recurrence
            ? "Optional: take this % off each lesson's per-person price when a player commits to a recurring series. Leave blank or 0 for no discount."
            : "Turn on recurring bookings above to offer a recurring discount."}
        </p>

        <details className="sm:col-span-6 rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-brand-700">Booking rules (optional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><label className="label text-xs">Min notice (hours)</label><input name="minNoticeHours" type="number" min={0} defaultValue={offering?.minNoticeHours ?? ""} placeholder="e.g. 12" className="input py-1" /></div>
            <div><label className="label text-xs">Booking horizon (days)</label><input name="bookingHorizonDays" type="number" min={1} max={365} defaultValue={offering?.bookingHorizonDays ?? ""} placeholder="42" className="input py-1" /></div>
            <div><label className="label text-xs">Buffer between lessons (min)</label><input name="bufferMin" type="number" min={0} step={5} defaultValue={offering?.bufferMin ?? ""} placeholder="e.g. 15" className="input py-1" /></div>
            <div><label className="label text-xs">Max lessons / day</label><input name="dailyCap" type="number" min={1} defaultValue={offering?.dailyCap ?? ""} placeholder="e.g. 6" className="input py-1" /></div>
            <div><label className="label text-xs">Cancellation window (hours)</label><input name="cancelWindowHours" type="number" min={0} defaultValue={offering?.cancelWindowHours ?? ""} placeholder="e.g. 24" className="input py-1" /></div>
            <div className="sm:col-span-3"><label className="label text-xs">Cancellation / refund policy (shown to players)</label><input name="cancelPolicy" defaultValue={offering?.cancelPolicy ?? ""} placeholder="e.g. Free cancellation 24h before; inside 24h is non-refundable." className="input py-1" /></div>
          </div>
        </details>

        <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="active" value="on" defaultChecked={offering ? offering.active : true} /> Bookable (players can book it; uncheck to pause without deleting)
        </label>
        <div className="sm:col-span-3 flex items-end justify-end">
          <button className="btn-primary py-1 text-sm">{offering ? "Save" : "Add offering"}</button>
        </div>
      </form>

      {offering && (
        confirmDel ? (
          <div className="flex items-center justify-end gap-2 text-right">
            <span className="text-xs text-slate-500">Remove this offering?</span>
            <form method="POST" action="/api/console/lesson-offerings">
              <input type="hidden" name="ticket" value={ticket} />
              {personId && <input type="hidden" name="personId" value={personId} />}
              <input type="hidden" name="op" value="deleteOffering" />
              <input type="hidden" name="offeringId" value={offering.id} />
              <button className="btn-chip-danger">Yes, remove</button>
            </form>
            <button type="button" onClick={() => setConfirmDel(false)} className="btn-chip-muted">Cancel</button>
          </div>
        ) : (
          <div className="text-right">
            <button type="button" onClick={() => setConfirmDel(true)} className="btn-chip-danger">Remove this offering</button>
          </div>
        )
      )}
    </div>
  );
}
