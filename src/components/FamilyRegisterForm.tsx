"use client";

import { useActionState, useState } from "react";
import { familyRegisterAction, type RegisterState } from "@/app/register/actions";
import { WaiverText, WAIVER_VERSION } from "@/components/WaiverText";

type Option = { id: string; name: string };

export function FamilyRegisterForm({
  seasonId,
  divisions,
  locations,
}: {
  seasonId: string;
  divisions: Option[];
  locations: string[];
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(familyRegisterAction, {});
  const [childCount, setChildCount] = useState(2);
  const today = new Date().toISOString().slice(0, 10);
  const children = Array.from({ length: childCount });

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="waiverVersion" value={WAIVER_VERSION} />

      <section className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Parent / guardian</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">First name</label><input name="guardianFirstName" className="input" required /></div>
          <div><label className="label">Last name</label><input name="guardianLastName" className="input" required /></div>
          <div><label className="label">Email</label><input name="guardianEmail" type="email" className="input" required /></div>
          <div><label className="label">Phone</label><input name="guardianPhone" type="tel" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Address</label><input name="guardianAddress" className="input" placeholder="Street, city, ZIP" /></div>
          <div>
            <label className="label">How did you hear about us?</label>
            <select name="guardianHowHeard" className="input" defaultValue="">
              <option value="">— Select —</option>
              <option>Friend or family</option><option>Social media</option>
              <option>Google or web search</option><option>Community event</option>
              <option>Flyer or sign</option><option>Coach or staff</option><option>Other</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Children</h2>
        {children.map((_, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Child #{i + 1}</span>
              {childCount > 1 && (
                <button type="button" onClick={() => setChildCount((c) => c - 1)} className="text-xs text-rose-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">First name</label><input name="childFirstName" className="input" required={i === 0} /></div>
              <div><label className="label">Last name</label><input name="childLastName" className="input" required={i === 0} /></div>
              <div>
                <label className="label">Gender</label>
                <select name="childGender" className="input" defaultValue="">
                  <option value="">— Select —</option><option>Male</option><option>Female</option>
                </select>
              </div>
              <div><label className="label">Date of birth</label><input name="childDob" type="date" className="input" /></div>
              <div className="sm:col-span-2">
                <label className="label">Division</label>
                <select name="childDivisionId" className="input" defaultValue="">
                  <option value="">— Unassigned —</option>
                  {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setChildCount((c) => c + 1)} className="btn-secondary">+ Add another child</button>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Locations</h2>
        <p className="text-sm text-slate-500">Rank the locations your family is willing to attend.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((r) => (
            <div key={r}>
              <label className="label">Location #{r}</label>
              <select name={`locationPref${r}`} className="input" defaultValue="">
                <option value="">— Select a location —</option>
                {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Waiver &amp; consent</h2>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
          <WaiverText />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="waiver" className="mt-0.5" required />
          <span>
            I am the parent or legal guardian of the child(ren) listed above. I have read,
            understand, and agree to the <strong>Acknowledgment of Risk, Waiver, and Release of
            Liability</strong> on their behalf, and to the season terms including the{" "}
            <strong>no make-up policy</strong>. I sign freely and voluntarily.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="mediaOptOut" className="mt-0.5" />
          <span>I do <strong>not</strong> consent to the use of photos/videos of my child(ren).</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Signature (type your full legal name)</label><input name="signatureName" className="input" required /></div>
          <div><label className="label">Date</label><input type="date" className="input" defaultValue={today} readOnly /></div>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold text-brand-900">Portal access (optional)</h2>
        <p className="text-sm text-slate-500">Create a password to track placement and pay later for your whole family.</p>
        <input name="password" type="password" className="input" placeholder="Choose a password" />
      </section>

      {state?.error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto">
        {pending ? "Submitting…" : "Submit family registration"}
      </button>
    </form>
  );
}
