"use client";

import { useState } from "react";
import { ACADEMY_MARKETS } from "@/lib/enums";
import { COACH_PUBLIC_FIELDS as PUBLIC_FIELDS } from "@/lib/domain/coachPublic";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Block = { dayOfWeek: string; startTime: string; endTime: string };

export function CoachProfileForm({
  ticket,
  email,
  firstName = "",
  lastName = "",
  editableIdentity = false,
  targetPersonId,
  initial,
  pay,
}: {
  ticket: string;
  email: string;
  firstName?: string;
  lastName?: string;
  /** When true (admin context), first/last name and email are editable. */
  editableIdentity?: boolean;
  /** Set when an admin edits another coach; omitted for self-service. */
  targetPersonId?: string;
  initial: {
    phone: string;
    rpoCertLevel: string;
    certifications: string;
    bio: string;
    coachingLevels: string;
    publicHidden: string[];
    markets: string[];
    availability: Block[];
    safeSport: boolean;
    backgroundCheck: boolean;
    backgroundCheckDate: string;
    backgroundCheckCompany: string;
    onboarding: boolean;
  };
  /** Admin-only compensation. Present only in the admin edit context, so a
   *  coach editing their own profile never sees (or can post) pay fields. */
  pay?: {
    seasonRate: string;
    seasonPct: string;
    lessonRate: string;
    lessonPct: string;
    clinicRate: string;
    clinicPct: string;
    notes: string;
  };
}) {
  const [blocks, setBlocks] = useState<Block[]>(
    initial.availability.length ? initial.availability : [{ dayOfWeek: "MON", startTime: "", endTime: "" }]
  );
  const [bgCheck, setBgCheck] = useState(initial.backgroundCheck);

  return (
    <form method="POST" action="/api/console/coach-profile" className="space-y-6">
      <input type="hidden" name="ticket" value={ticket} />
      {targetPersonId && <input type="hidden" name="personId" value={targetPersonId} />}

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Contact</h2>
        {editableIdentity ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">First name</label>
              <input name="firstName" className="input" defaultValue={firstName} required />
            </div>
            <div>
              <label className="label">Last name</label>
              <input name="lastName" className="input" defaultValue={lastName} required />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" className="input" defaultValue={email} />
              <p className="mt-1 text-xs text-slate-400">Updates their login email too, if they have an account.</p>
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" type="tel" className="input" defaultValue={initial.phone} />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Email</label>
              <input className="input bg-slate-50" value={email} readOnly />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" type="tel" className="input" defaultValue={initial.phone} />
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Certification &amp; experience</h2>
        <div className="grid gap-4">
          <div>
            <label className="label">Certification level (e.g. RPO Level 2, PPR, IPTPA)</label>
            <input name="rpoCertLevel" className="input" defaultValue={initial.rpoCertLevel} placeholder="RPO Level 2" />
          </div>
          <div>
            <label className="label">Certifications &amp; credentials</label>
            <textarea name="certifications" rows={2} className="input" defaultValue={initial.certifications}
              placeholder="List your certifications, governing bodies, expiry dates…" />
          </div>
          <div>
            <label className="label">Coaching history</label>
            <textarea name="bio" rows={3} className="input" defaultValue={initial.bio}
              placeholder="Where you've coached, years of experience, playing background…" />
          </div>
          <div>
            <label className="label">Levels you can coach</label>
            <input name="coachingLevels" className="input" defaultValue={initial.coachingLevels}
              placeholder="e.g. 2.5–4.0, Youth (Elementary–High School), Beginners" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800">What the public sees</div>
            <p className="mt-0.5 text-xs text-slate-500">
              Choose which fields show on your public profile (/coaches). Your name and photo always show once
              published. Unchecked fields stay private.
            </p>
            <input type="hidden" name="pubVisible" value="1" />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PUBLIC_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <input type="checkbox" name="pubShow" value={f.key} defaultChecked={!initial.publicHidden.includes(f.key)} className="h-4 w-4" />
                  <span className="text-slate-700">{f.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Screening &amp; compliance</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Safe Sport certified</label>
            <select name="safeSport" className="input" defaultValue={initial.safeSport ? "yes" : "no"}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          <div>
            <label className="label">Background check</label>
            <select name="bgCheck" className="input" value={bgCheck ? "yes" : "no"} onChange={(e) => setBgCheck(e.target.value === "yes")}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          <div>
            <label className="label">Curriculum onboarding</label>
            <select name="onboarding" className="input" defaultValue={initial.onboarding ? "yes" : "no"}>
              <option value="no">Not complete</option>
              <option value="yes">Complete</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">A completed background check and onboarding are both required before a coach can be assigned to a team.</p>
          </div>
          {bgCheck && (
            <>
              <div>
                <label className="label">Date checked</label>
                <input name="bgDate" type="date" className="input" defaultValue={initial.backgroundCheckDate} />
              </div>
              <div>
                <label className="label">Company that ran the check</label>
                <input name="bgCompany" className="input" defaultValue={initial.backgroundCheckCompany} placeholder="e.g. Sterling, Checkr" />
              </div>
            </>
          )}
        </div>
      </section>

      {pay && (
        <section className="card space-y-4 ring-1 ring-amber-200 bg-amber-50/40">
          <div>
            <h2 className="font-semibold text-slate-900">Compensation</h2>
            <p className="text-sm text-slate-500">
              Admin only — not visible to the coach. Enter a flat rate and/or a percentage for each work type.
              Leave a field blank if it doesn&apos;t apply.
            </p>
          </div>
          <input type="hidden" name="payVisible" value="1" />

          <div className="space-y-4">
            {([
              ["season", "Regular season", "per team / season", "e.g. 60"],
              ["lesson", "Private / semi-private lessons", "per lesson or hour", "e.g. 70"],
              ["clinic", "Clinics", "per participant or session", "e.g. 50"],
            ] as const).map(([key, label, rateHint, pctHint]) => (
              <div key={key} className="grid gap-3 sm:grid-cols-[1fr_1fr] rounded-lg bg-white/70 p-3 ring-1 ring-slate-100">
                <div className="sm:col-span-2 text-sm font-semibold text-slate-800">{label}</div>
                <div>
                  <label className="label">Flat rate ({rateHint})</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                    <input
                      name={`${key}Rate`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="input pl-6"
                      defaultValue={pay[`${key}Rate` as const]}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Percentage</label>
                  <div className="relative">
                    <input
                      name={`${key}Pct`}
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      inputMode="numeric"
                      className="input pr-7"
                      defaultValue={pay[`${key}Pct` as const]}
                      placeholder={pctHint}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
                  </div>
                </div>
              </div>
            ))}
            <div>
              <label className="label">Pay notes</label>
              <textarea name="payNotes" rows={2} className="input" defaultValue={pay.notes}
                placeholder="Tiers, guarantees, per-hour vs per-session, bonuses…" />
            </div>
          </div>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Location availability</h2>
        <p className="text-sm text-slate-500">Which markets can you coach in?</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {ACADEMY_MARKETS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="market" value={m} defaultChecked={initial.markets.includes(m)} /> {m}
            </label>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Day &amp; time availability</h2>
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Day</label>
                <select name="availDay" defaultValue={b.dayOfWeek} className="input py-1">
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">From</label>
                <input name="availStart" type="time" defaultValue={b.startTime} className="input py-1" />
              </div>
              <div>
                <label className="label">To</label>
                <input name="availEnd" type="time" defaultValue={b.endTime} className="input py-1" />
              </div>
              {blocks.length > 1 && (
                <button type="button" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))}
                  className="mb-1 text-xs text-rose-600 hover:underline">remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setBlocks((bs) => [...bs, { dayOfWeek: "MON", startTime: "", endTime: "" }])}
          className="btn-secondary text-sm">+ Add availability</button>
      </section>

      <button type="submit" className="btn-primary">Save profile</button>
    </form>
  );
}
