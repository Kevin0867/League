"use client";

import { useActionState, useState } from "react";
import { registerAction, type RegisterState } from "@/app/register/actions";

type Option = { id: string; name: string };

export function RegisterForm({
  seasonId,
  divisions,
  locations,
}: {
  seasonId: string;
  divisions: Option[];
  locations: string[];
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(
    registerAction,
    {}
  );
  const [isMinor, setIsMinor] = useState(false);

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="seasonId" value={seasonId} />

      <Section title="Player details" subtitle="One record per person — coaches register here too, with the fee waived.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" type="tel" />
          <div>
            <label className="label" htmlFor="dob">Date of birth</label>
            <input
              id="dob" name="dob" type="date" className="input"
              onChange={(e) => {
                const d = e.target.valueAsDate;
                setIsMinor(d ? new Date().getFullYear() - d.getFullYear() < 18 : false);
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="gender">Gender</label>
            <select id="gender" name="gender" className="input" defaultValue="">
              <option value="">— Select —</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="skillLevel">Skill level</label>
            <select id="skillLevel" name="skillLevel" className="input" defaultValue="">
              <option value="">— Select —</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Division & DUPR" subtitle="Pick ONE division. Players between bands are placed by the Academy Director after the Week-1 assessment.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="divisionId">Division</label>
            <select id="divisionId" name="divisionId" className="input">
              <option value="">— Select a division —</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <Field label="DUPR account ID" name="duprId" placeholder="Required before first league match" />
          <Field label="Current DUPR rating" name="duprRating" type="number" />
        </div>
        {isMinor && (
          <label className="mt-4 flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm">
            <input type="checkbox" name="parentalConsent" className="mt-0.5" />
            <span>
              As parent/guardian I give <strong>DUPR parental consent</strong> for this
              under-18 player (required for league play).
            </span>
          </label>
        )}
      </Section>

      <Section title="Preferences" subtitle="Pools overlap on location and time. Rank the locations you're willing to attend — pick as many as work for you.">
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((r) => (
            <div key={r}>
              <label className="label" htmlFor={`locationPref${r}`}>Location #{r}</label>
              <select id={`locationPref${r}`} name={`locationPref${r}`} className="input" defaultValue="">
                <option value="">— Select a location —</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="practiceTimePref">Practice time preference</label>
            <select id="practiceTimePref" name="practiceTimePref" className="input">
              <option value="">—</option>
              <option value="weeknight">Weeknight</option>
              <option value="weekday">Weekday</option>
              <option value="weekend">Weekend</option>
            </select>
          </div>
          <Field label="Days that don't work" name="daysThatDontWork" placeholder="e.g. Tuesdays, Thursdays" />
          <Field label="Partner / friend requests" name="partnerRequests" />
          <Field label="Medical disclosures" name="medical" />
        </div>
      </Section>

      <Section title="Emergency contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" name="emergencyName" />
          <Field label="Contact phone" name="emergencyPhone" type="tel" />
        </div>
      </Section>

      <Section title="Waiver & consent" subtitle="No player appears on a court-ready roster without a signed waiver.">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="waiver" className="mt-0.5" required />
          <span>
            I have read and accept the liability waiver and the season terms,
            including the <strong>no make-up policy</strong> — the season fee reserves a
            place on a team, not a session count. Individual practices that PURE
            cancels are not refunded or credited.
          </span>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Signature (type full name)" name="signatureName" required />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="mediaOptOut" />
            <span>Opt out of media/photo consent</span>
          </label>
        </div>
      </Section>

      <Section title="Portal access (optional)" subtitle="Create a password to track placement and pay later. Payment is requested only after you're assigned a team.">
        <Field label="Choose a password" name="password" type="password" />
      </Section>

      {state?.error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Submitting…" : "Submit registration"}
        </button>
        <span className="text-sm text-slate-500">No payment is required to register.</span>
      </div>
    </form>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-4 mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Field({
  label, name, type = "text", required, placeholder,
}: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <input id={name} name={name} type={type} required={required} placeholder={placeholder} className="input" />
    </div>
  );
}
