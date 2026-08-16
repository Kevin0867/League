"use client";

import { TimeSelect } from "@/components/TimeSelect";
import { useState } from "react";

type CourtBlockInit = { dayOfWeek: string; startTime: string; endTime: string; courtCount: number; kind?: string };
type BlockedInit = { dayOfWeek: string; startTime: string; endTime: string };

export type FacilityInitial = {
  id: string;
  name: string;
  market: string | null;
  courtCount: number;
  agreementStatus: string;
  feeBasis: string;
  weekdayRateCents: number;
  weekendRateCents: number;
  percentageRate: number | null;
  primaryContact: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isPrivate: boolean;
  generalArea: string | null;
  exactAddress: string | null;
  lights: string | null;
  notes: string | null;
  alaCarteAllowed: boolean;
  acpLeagueOption: boolean;
  courtBlocks: CourtBlockInit[];
};

const dollars = (cents: number) => (cents ? (cents / 100).toFixed(2) : "");
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABEL: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

// A titled section with a short helper line — gives the form real hierarchy
// instead of one long wall of inputs.
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-5 first:border-0 first:pt-0">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// One form, two modes: add a facility (no `facility`) or edit an existing one.
// Opens as a full-width modal so the fields have room to breathe instead of
// being squeezed into a half-width card.
export function FacilityForm({ ticket, facility }: { ticket: string; facility?: FacilityInitial }) {
  const editing = !!facility;
  const [open, setOpen] = useState(false);
  const [feeBasis, setFeeBasis] = useState(facility?.feeBasis ?? "NONE");
  const [isPrivate, setIsPrivate] = useState(facility?.isPrivate ?? false);
  const [blocks, setBlocks] = useState<CourtBlockInit[]>((facility?.courtBlocks ?? []).filter((b) => (b.kind ?? "AVAILABLE") === "AVAILABLE"));
  const [blocked, setBlocked] = useState<BlockedInit[]>(
    (facility?.courtBlocks ?? []).filter((b) => b.kind === "BLOCKED").map((b) => ({ dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime })),
  );

  if (!open) {
    return editing ? (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-brand-700 hover:underline">Edit</button>
    ) : (
      <button onClick={() => setOpen(true)} className="btn-primary">+ Add facility</button>
    );
  }

  const perRate = feeBasis === "PER_COURT" || feeBasis === "PER_HOUR" || feeBasis === "PER_SESSION";
  const addBlock = () => setBlocks((b) => [...b, { dayOfWeek: "MON", startTime: "", endTime: "", courtCount: facility?.courtCount || 1 }]);
  const removeBlock = (i: number) => setBlocks((b) => b.filter((_, j) => j !== i));
  const addBlocked = () => setBlocked((b) => [...b, { dayOfWeek: "MON", startTime: "", endTime: "" }]);
  const removeBlocked = (i: number) => setBlocked((b) => b.filter((_, j) => j !== i));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <form method="POST" action="/api/console/facilities" className="my-4 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value={editing ? "edit" : "create"} />
        {editing && <input type="hidden" name="facilityId" value={facility!.id} />}

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">{editing ? `Edit ${facility!.name}` : "Add a facility"}</h3>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          <Section title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Name</label>
                <input name="name" className="input" placeholder="Scottsdale Ranch Pickleball Complex" defaultValue={facility?.name ?? ""} required />
              </div>
              <div>
                <label className="label">Market / city</label>
                <input name="market" className="input" placeholder="Scottsdale" defaultValue={facility?.market ?? ""} />
              </div>
              <div>
                <label className="label">Court count</label>
                <input name="courtCount" type="number" min="0" className="input" defaultValue={facility?.courtCount ?? 0} />
              </div>
              <div>
                <label className="label">Agreement status</label>
                <select name="agreementStatus" className="input" defaultValue={facility?.agreementStatus ?? "IDENTIFIED"}>
                  <option value="IDENTIFIED">Identified</option>
                  <option value="VERBAL">Verbal</option>
                  <option value="AGREEMENT_SENT">Agreement sent</option>
                  <option value="EXECUTED">Executed</option>
                </select>
              </div>
              <div>
                <label className="label">Lights</label>
                <select name="lights" className="input" defaultValue={facility?.lights ?? ""}>
                  <option value="">Not specified</option>
                  <option value="LIGHTS">Has lights (evening play OK)</option>
                  <option value="NO_LIGHTS">No lights (daylight only)</option>
                </select>
              </div>
            </div>
          </Section>

          <Section title="Court availability" hint="Which days and times courts are open here. These windows now limit team scheduling — a team can only practice here on a day/time you list below (leave empty to allow any day/time).">
            <div className="space-y-2">
              {blocks.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No open times set yet — teams could be scheduled here any day/time. Add a day and time below to limit it.</p>}
              {blocks.map((b, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg ring-1 ring-slate-100 p-2">
                  <div>
                    <label className="label">Day</label>
                    <select
                      name="availDay"
                      value={b.dayOfWeek}
                      onChange={(e) => setBlocks((bs) => bs.map((x, j) => (j === i ? { ...x, dayOfWeek: e.target.value } : x)))}
                      className="input py-1.5"
                    >
                      {DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">From</label>
                    <TimeSelect
                      name="availStart" className="input py-1.5" value={b.startTime}
                      onChange={(e) => setBlocks((bs) => bs.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))}
                    />
                  </div>
                  <div>
                    <label className="label">To</label>
                    <TimeSelect
                      name="availEnd" className="input py-1.5" value={b.endTime}
                      onChange={(e) => setBlocks((bs) => bs.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))}
                    />
                  </div>
                  <div className="w-20">
                    <label className="label">Courts</label>
                    <input
                      name="availCourts" type="number" min="1" className="input py-1.5" value={b.courtCount}
                      onChange={(e) => setBlocks((bs) => bs.map((x, j) => (j === i ? { ...x, courtCount: parseInt(e.target.value, 10) || 1 } : x)))}
                    />
                  </div>
                  <button type="button" onClick={() => removeBlock(i)} className="mb-1.5 text-xs text-rose-600 hover:underline">Remove</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addBlock} className="btn-secondary mt-2 text-sm">+ Add day / time</button>
          </Section>

          <Section title="Unavailable / blocked times" hint="Recurring day/time windows the courts are NOT available (leagues, HOA use, dark hours). A blocked window overrides availability — nothing can be scheduled here then.">
            <div className="space-y-2">
              {blocked.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No blocked times. Add a window below to mark the courts unavailable then.</p>}
              {blocked.map((b, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg ring-1 ring-rose-100 bg-rose-50/40 p-2">
                  <div>
                    <label className="label">Day</label>
                    <select
                      name="blockDay"
                      value={b.dayOfWeek}
                      onChange={(e) => setBlocked((bs) => bs.map((x, j) => (j === i ? { ...x, dayOfWeek: e.target.value } : x)))}
                      className="input py-1.5"
                    >
                      {DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">From</label>
                    <TimeSelect
                      name="blockStart" className="input py-1.5" value={b.startTime}
                      onChange={(e) => setBlocked((bs) => bs.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))}
                    />
                  </div>
                  <div>
                    <label className="label">To</label>
                    <TimeSelect
                      name="blockEnd" className="input py-1.5" value={b.endTime}
                      onChange={(e) => setBlocked((bs) => bs.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))}
                    />
                  </div>
                  <button type="button" onClick={() => removeBlocked(i)} className="mb-1.5 text-xs text-rose-600 hover:underline">Remove</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addBlocked} className="btn-secondary mt-2 text-sm">+ Add blocked window</button>
          </Section>

          <Section title="Fee" hint="How this venue charges, if at all.">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Fee basis</label>
                <select name="feeBasis" value={feeBasis} onChange={(e) => setFeeBasis(e.target.value)} className="input">
                  <option value="NONE">No fee / in-kind</option>
                  <option value="PER_COURT">Per court</option>
                  <option value="PER_HOUR">Per hour</option>
                  <option value="PER_SESSION">Per session</option>
                  <option value="PERCENTAGE">Percentage of on-site revenue</option>
                </select>
              </div>
              {perRate && (
                <>
                  <div>
                    <label className="label">Weekday rate ($)</label>
                    <input name="weekdayRate" type="number" step="0.01" className="input" placeholder="0.00" defaultValue={dollars(facility?.weekdayRateCents ?? 0)} />
                  </div>
                  <div>
                    <label className="label">Weekend rate ($)</label>
                    <input name="weekendRate" type="number" step="0.01" className="input" placeholder="0.00" defaultValue={dollars(facility?.weekendRateCents ?? 0)} />
                  </div>
                </>
              )}
              {feeBasis === "PERCENTAGE" && (
                <div>
                  <label className="label">Percentage (%)</label>
                  <input name="percentageRate" type="number" step="0.1" className="input" placeholder="15" defaultValue={facility?.percentageRate ? String((facility.percentageRate * 100).toFixed(0)) : ""} />
                </div>
              )}
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Primary contact</label>
                <input name="primaryContact" className="input" defaultValue={facility?.primaryContact ?? ""} />
              </div>
              <div>
                <label className="label">Contact email</label>
                <input name="contactEmail" type="email" className="input" defaultValue={facility?.contactEmail ?? ""} />
              </div>
              <div>
                <label className="label">Contact phone</label>
                <input name="contactPhone" className="input" defaultValue={facility?.contactPhone ?? ""} />
              </div>
            </div>
          </Section>

          <Section title="What this venue allows">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm transition hover:border-slate-300">
                <input type="checkbox" name="alaCarteAllowed" defaultChecked={facility?.alaCarteAllowed ?? false} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="font-medium text-slate-800">Private Lessons</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Coaches may run private &amp; semi-private lessons here.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm transition hover:border-slate-300">
                <input type="checkbox" name="acpLeagueOption" defaultChecked={facility?.acpLeagueOption ?? false} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="font-medium text-slate-800">ACP league play</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Can host Arizona Club Pickleball league matches.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm transition hover:border-slate-300">
                <input type="checkbox" name="isPrivate" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="font-medium text-slate-800">Private residence / court</span>
                  <span className="mt-0.5 block text-xs text-slate-500">A home or private court, not a public facility.</span>
                </span>
              </label>
            </div>
          </Section>

          <Section title="Location" hint={isPrivate ? "Private venue — the public only ever sees the general area." : undefined}>
            {isPrivate ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Public general area</label>
                  <input name="generalArea" className="input" placeholder="North Scottsdale" defaultValue={facility?.generalArea ?? ""} />
                  <p className="mt-1 text-xs text-slate-400">Shown publicly. Never the owner name or street address.</p>
                </div>
                <div>
                  <label className="label">Exact address (behind login)</label>
                  <input name="exactAddress" className="input" defaultValue={facility?.exactAddress ?? ""} />
                  <p className="mt-1 text-xs text-slate-400">Released only to assigned players.</p>
                </div>
              </div>
            ) : (
              <div>
                <label className="label">Address</label>
                <input name="exactAddress" className="input" defaultValue={facility?.exactAddress ?? ""} />
              </div>
            )}
          </Section>

          <Section title="Notes & access" hint="Details about the venue — where to park, how to get in, gate/door codes context, house rules, anything staff and coaches should know.">
            <textarea
              name="notes"
              rows={4}
              className="input"
              placeholder={"Park in the north lot off Elm. Enter through the side gate — code on the day-of text. Dogs on the property. Bring your own water; no vending on site."}
              defaultValue={facility?.notes ?? ""}
            />
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button type="submit" className="btn-primary">{editing ? "Save changes" : "Create facility"}</button>
        </div>
      </form>
    </div>
  );
}

export function DeleteFacilityButton({
  facilityId,
  ticket,
  inUse,
}: {
  facilityId: string;
  ticket: string;
  inUse: boolean;
}) {
  if (inUse) {
    return (
      <span className="text-xs text-slate-400" title="Facilities used by teams or sessions can't be deleted.">
        In use — can&apos;t remove
      </span>
    );
  }
  return (
    <form
      method="POST"
      action="/api/console/facilities"
      onSubmit={(e) => { if (!confirm("Remove this facility? This can't be undone.")) e.preventDefault(); }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="delete" />
      <input type="hidden" name="facilityId" value={facilityId} />
      <button className="text-xs text-rose-600 hover:underline">Remove</button>
    </form>
  );
}
