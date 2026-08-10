"use client";

import { useState } from "react";
import { ACADEMY_MARKETS } from "@/lib/enums";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Block = { dayOfWeek: string; startTime: string; endTime: string };

export function CoachProfileForm({
  ticket,
  email,
  targetPersonId,
  initial,
  pay,
}: {
  ticket: string;
  email: string;
  /** Set when an admin edits another coach; omitted for self-service. */
  targetPersonId?: string;
  initial: {
    phone: string;
    rpoCertLevel: string;
    certifications: string;
    bio: string;
    coachingLevels: string;
    markets: string[];
    availability: Block[];
    safeSport: boolean;
    backgroundCheck: boolean;
    backgroundCheckDate: string;
    backgroundCheckCompany: string;
    w9: {
      onFile: boolean;
      receivedAt: string;
      name: string;
      businessName: string;
      taxClass: string;
      llcClass: string;
      otherClass: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      tinType: string;
      tinLast4: string;
      signedName: string;
    };
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
  const [taxClass, setTaxClass] = useState(initial.w9.taxClass || "INDIVIDUAL");
  const [tinType, setTinType] = useState(initial.w9.tinType || "SSN");
  const w9OnFile = initial.w9.onFile;

  return (
    <form method="POST" action="/api/console/coach-profile" className="space-y-6">
      <input type="hidden" name="ticket" value={ticket} />
      {targetPersonId && <input type="hidden" name="personId" value={targetPersonId} />}

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Contact</h2>
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

      <section className="card space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">Form W-9 — Taxpayer Identification &amp; Certification</h2>
            {w9OnFile ? (
              <span className="badge bg-emerald-100 text-emerald-800">on file</span>
            ) : (
              <span className="badge bg-amber-100 text-amber-800">needed</span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Required to be paid as a PURE Academy coach (IRS Form W-9, Rev. March 2024). Your
            taxpayer ID number is encrypted at rest — after you save it, only the last four digits
            are ever shown back.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">1. Name (as shown on your income tax return)</label>
            <input name="w9Name" className="input" defaultValue={initial.w9.name} placeholder="Full legal name" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">2. Business name / disregarded entity name, if different from above</label>
            <input name="w9BusinessName" className="input" defaultValue={initial.w9.businessName} placeholder="Optional" />
          </div>
        </div>

        <div>
          <label className="label">3a. Federal tax classification</label>
          <select name="w9TaxClass" className="input" value={taxClass} onChange={(e) => setTaxClass(e.target.value)}>
            <option value="INDIVIDUAL">Individual / sole proprietor</option>
            <option value="C_CORP">C corporation</option>
            <option value="S_CORP">S corporation</option>
            <option value="PARTNERSHIP">Partnership</option>
            <option value="TRUST_ESTATE">Trust / estate</option>
            <option value="LLC">Limited liability company (LLC)</option>
            <option value="OTHER">Other</option>
          </select>
          {taxClass === "LLC" && (
            <div className="mt-2">
              <label className="label">LLC tax classification (C = C corporation, S = S corporation, P = Partnership)</label>
              <select name="w9LlcClass" className="input" defaultValue={initial.w9.llcClass || "C"}>
                <option value="C">C — C corporation</option>
                <option value="S">S — S corporation</option>
                <option value="P">P — Partnership</option>
              </select>
            </div>
          )}
          {taxClass === "OTHER" && (
            <div className="mt-2">
              <label className="label">Other — describe</label>
              <input name="w9OtherClass" className="input" defaultValue={initial.w9.otherClass} placeholder="See W-9 instructions" />
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <label className="label">5. Address (number, street, and apt. or suite no.)</label>
            <input name="w9Address" className="input" defaultValue={initial.w9.address} />
          </div>
          <div className="sm:col-span-3">
            <label className="label">6. City</label>
            <input name="w9City" className="input" defaultValue={initial.w9.city} />
          </div>
          <div className="sm:col-span-1">
            <label className="label">State</label>
            <input name="w9State" className="input" defaultValue={initial.w9.state} maxLength={2} placeholder="AZ" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">ZIP code</label>
            <input name="w9Zip" className="input" defaultValue={initial.w9.zip} inputMode="numeric" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Part I — Taxpayer Identification Number (TIN) type</label>
            <select name="w9TinType" className="input" value={tinType} onChange={(e) => setTinType(e.target.value)}>
              <option value="SSN">Social security number (SSN)</option>
              <option value="EIN">Employer identification number (EIN)</option>
            </select>
          </div>
          <div>
            <label className="label">{tinType === "EIN" ? "EIN" : "SSN"}</label>
            <input
              name="w9Tin"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              placeholder={w9OnFile && initial.w9.tinLast4 ? `On file — ends in ${initial.w9.tinLast4}` : tinType === "EIN" ? "12-3456789" : "123-45-6789"}
            />
            <p className="mt-1 text-xs text-slate-400">
              {w9OnFile && initial.w9.tinLast4
                ? `A number ending in ${initial.w9.tinLast4} is on file. Leave blank to keep it, or type a new one to replace it.`
                : "Digits only — dashes optional."}
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-700">Part II — Certification</p>
          <p className="mt-1">Under penalties of perjury, I certify that:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and</li>
            <li>I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and</li>
            <li>I am a U.S. citizen or other U.S. person (as defined in the Form W-9 instructions); and</li>
            <li>The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.</li>
          </ol>
          <p className="mt-2 text-slate-500">
            The IRS does not require your consent to any provision of this document other than the certifications required to
            avoid backup withholding.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Signature — type your full legal name to certify</label>
            <input name="w9SignedName" className="input" defaultValue={initial.w9.signedName} placeholder="Type your full name" />
          </div>
          {w9OnFile && initial.w9.receivedAt && (
            <div className="flex items-end">
              <p className="text-sm text-slate-500">On file since {initial.w9.receivedAt}</p>
            </div>
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
