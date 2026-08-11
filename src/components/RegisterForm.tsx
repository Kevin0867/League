"use client";

import { useActionState, useState } from "react";
import { registerAction, type RegisterState } from "@/app/register/actions";
import { WaiverText, WAIVER_VERSION } from "@/components/WaiverText";
import { EMAIL_CONSENT_TEXT, SMS_CONSENT_TEXT } from "@/lib/consent";

const YOUTH_LEVELS = ["High School", "Middle", "Elementary"];
const ADULT_TEAMS = ["Men's", "Women's"];
const SKILLS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0+"];
const PRACTICE_TIMES = ["Mornings", "Evenings"];
const MAX_KIDS = 4;

type Mode = "adult" | "child" | "both";

export function RegisterForm({
  seasonId,
  locations,
  preselectedDivision = null,
  preselectedLocation = null,
  preferredFacility = null,
}: {
  seasonId: string;
  locations: string[];
  preselectedDivision?: string | null;
  preselectedLocation?: string | null;
  preferredFacility?: { id: string; label: string } | null;
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerAction, {});
  const [mode, setMode] = useState<Mode>("adult");
  const [kidCount, setKidCount] = useState(1);
  const today = new Date().toISOString().slice(0, 10);

  const adultPlaying = mode === "adult" || mode === "both";
  const hasChildren = mode === "child" || mode === "both";
  const kids = Array.from({ length: kidCount });

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="waiverVersion" value={WAIVER_VERSION} />
      {preselectedDivision && <input type="hidden" name="preferredDivision" value={preselectedDivision} />}
      {preferredFacility && <input type="hidden" name="preferredFacilityId" value={preferredFacility.id} />}

      {/* 01 — Who's playing */}
      <Section n="01" title="Who's playing?">
        <div className="grid gap-3 sm:grid-cols-3">
          <ModeCard value="adult" mode={mode} setMode={setMode} title="Myself" sub="Adult, 18 or older" />
          <ModeCard value="child" mode={mode} setMode={setMode} title="My child" sub="Player under 18" />
          <ModeCard value="both" mode={mode} setMode={setMode} title="Myself and my child(ren)" sub="One adult + up to 4 kids" />
        </div>
      </Section>

      {/* 02 — Player Information */}
      <Section n="02" title="Player information">
        {adultPlaying && (
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="mb-3 text-sm font-medium text-slate-600">You (adult player)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" name="primaryFirst" required />
              <Field label="Last name" name="primaryLast" required />
              <div className="sm:col-span-2">
                <label className="label" htmlFor="primaryDob">Date of birth <span className="text-rose-500">*</span></label>
                <input id="primaryDob" name="primaryDob" type="date" className="input" required />
                <p className="mt-1 text-xs text-slate-400">We use this to match the player to the right age group.</p>
              </div>
            </div>
          </div>
        )}

        {hasChildren && (
          <div className={adultPlaying ? "mt-4 space-y-4" : "space-y-4"}>
            {kids.map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">Child #{i + 1}</span>
                  {kidCount > 1 && (
                    <button type="button" onClick={() => setKidCount((c) => c - 1)} className="text-xs text-rose-600 hover:underline">
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" name="kidFirst" required={i === 0} />
                  <Field label="Last name" name="kidLast" required={i === 0} />
                  <div className="sm:col-span-2">
                    <label className="label">Date of birth {i === 0 && <span className="text-rose-500">*</span>}</label>
                    <input name="kidDob" type="date" className="input" required={i === 0} />
                    <p className="mt-1 text-xs text-slate-400">We use this to match the player to the right age group.</p>
                  </div>
                </div>
              </div>
            ))}
            {kidCount < MAX_KIDS && (
              <button type="button" onClick={() => setKidCount((c) => Math.min(MAX_KIDS, c + 1))} className="btn-secondary">
                + Add another child
              </button>
            )}
            {kidCount >= MAX_KIDS && (
              <p className="text-xs text-slate-400">Up to {MAX_KIDS} children can share one waiver.</p>
            )}
          </div>
        )}
      </Section>

      {/* 03 — Program Interest */}
      <Section n="03" title="Program interest" subtitle="Pick the track and skill level that fits each player. Our team confirms placement after you register.">
        {adultPlaying && (
          <ProgramRow label="You" teamName="primaryTeam" skillName="primarySkill" teams={ADULT_TEAMS} groupLabel="Adult ELITE TEAMS" />
        )}
        {hasChildren && (
          <div className={adultPlaying ? "mt-4 space-y-4" : "space-y-4"}>
            {kids.map((_, i) => (
              <ProgramRow
                key={i}
                label={`Child #${i + 1}`}
                teamName="kidTeam"
                skillName="kidSkill"
                teams={YOUTH_LEVELS}
                groupLabel="Youth ELITE TEAMS"
              />
            ))}
          </div>
        )}
      </Section>

      {/* 04 — Preferences */}
      <Section n="04" title="Preferences">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className="label">Location <span className="text-slate-400">(choose all that work)</span></label>
            {preferredFacility?.label && (
              <p className="mt-1 mb-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-100">
                Selected court: <span className="font-semibold">{preferredFacility.label}</span> — your registration will be placed here.
              </p>
            )}
            <div className="mt-1 space-y-2">
              {locations.map((loc) => (
                <label key={loc} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="location"
                    value={loc}
                    defaultChecked={!!preselectedLocation && loc.toLowerCase() === preselectedLocation.toLowerCase()}
                  />
                  {loc}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Practice times <span className="text-slate-400">(choose all that work)</span></label>
            <div className="mt-1 space-y-2">
              {PRACTICE_TIMES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="practiceTime" value={t} />
                  {t}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* 05 — Contact Information */}
      <Section n="05" title="Contact information">
        <div className="grid gap-4 sm:grid-cols-2">
          {!adultPlaying && (
            <>
              <Field label="Parent / guardian first name" name="primaryFirst" required />
              <Field label="Parent / guardian last name" name="primaryLast" required />
            </>
          )}
          <Field label="Email" name="primaryEmail" type="email" required />
          <Field label="Phone" name="primaryPhone" type="tel" required />
          <div className="sm:col-span-2">
            <label className="label" htmlFor="comments">Comments <span className="text-slate-400">(optional)</span></label>
            <textarea
              id="comments" name="comments" rows={3} className="input"
              placeholder="How long they've played, current level, what they want to work on…"
            />
          </div>
        </div>
      </Section>

      {/* Waiver & signature */}
      <Section title="Waiver & consent" subtitle="No player appears on a court-ready roster without a signed waiver. One signature covers everyone listed above.">
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
          <WaiverText />
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" name="waiver" className="mt-0.5" required />
          <span>
            I have read, understand, and agree to the{" "}
            <strong>Acknowledgment of Risk, Waiver, and Release of Liability</strong>{" "}
            above, and to the season terms including the{" "}
            <strong>no make-up policy</strong>. If registering a minor, I certify I am
            their parent or legal guardian and sign on their behalf.
          </span>
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="signatureName">Signature (type full legal name)</label>
            <input id="signatureName" name="signatureName" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="waiverDate">Date</label>
            <input id="waiverDate" name="waiverDate" type="date" className="input" defaultValue={today} readOnly />
          </div>
        </div>

        {/* Express email/SMS opt-in — optional, never a condition of registration. */}
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Stay in the loop (optional)</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="emailOptIn" className="mt-0.5" defaultChecked />
            <span className="text-slate-600">{EMAIL_CONSENT_TEXT}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="smsOptIn" className="mt-0.5" />
            <span className="text-slate-600">{SMS_CONSENT_TEXT}</span>
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

function ModeCard({
  value, mode, setMode, title, sub,
}: { value: Mode; mode: Mode; setMode: (m: Mode) => void; title: string; sub: string }) {
  const active = mode === value;
  return (
    <label
      className={`flex cursor-pointer flex-col rounded-lg border p-4 ${
        active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio" name="mode" value={value} checked={active}
          onChange={() => setMode(value)} className="accent-brand-600"
        />
        <span className="font-medium text-slate-900">{title}</span>
      </span>
      <span className="mt-1 pl-6 text-xs text-slate-500">{sub}</span>
    </label>
  );
}

function ProgramRow({
  label, teamName, skillName, teams, groupLabel,
}: { label: string; teamName: string; skillName: string; teams: string[]; groupLabel: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="mb-3 text-sm font-medium text-slate-600">{label}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">{groupLabel}</label>
          <select name={teamName} className="input" defaultValue="">
            <option value="">— Select —</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Skill level</label>
          <select name={skillName} className="input" defaultValue="">
            <option value="">— Select —</option>
            {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function Section({
  n, title, subtitle, children,
}: { n?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">
          {n && <span className="mr-2 text-sm font-semibold text-brand-500">{n}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
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
