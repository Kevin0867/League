"use client";

import { useRef, useState } from "react";
import { WaiverText } from "@/components/WaiverText";

type Participant = { id: string; name: string; gender: string | null; dob: string; role: string };

// Client-side waiver form. We deliberately turn OFF native browser validation
// (`noValidate`) and validate ourselves, because Safari silently blocks a form
// submit on a `required` <select> with a placeholder option WITHOUT showing any
// message — the user just sees the "Sign waiver" button do nothing. Here we
// always surface exactly what's missing, scroll to it, and highlight it.
export function WaiverSignForm({
  token,
  waiverVersion,
  next,
  today,
  isMinor,
  personFirstName,
  personEmail,
  personPhone,
  participants,
}: {
  token: string;
  waiverVersion: string;
  next?: string;
  today: string;
  isMinor: boolean;
  personFirstName: string;
  personEmail: string;
  personPhone: string;
  participants: Participant[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Only the legal essentials block signing: agreement, a typed signature, and
  // (for a minor) a parent/guardian email. Gender is optional — never block a
  // signature on a demographic dropdown. We always preventDefault and submit the
  // form programmatically when valid, so a click can never silently no-op.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const form = e.currentTarget;
    const missing: string[] = [];
    const badFields: HTMLElement[] = [];
    const flag = (el: HTMLElement | null) => { if (el) badFields.push(el); };

    // Agreement checkbox
    const agree = form.elements.namedItem("agree") as HTMLInputElement | null;
    if (!agree?.checked) { missing.push("Check the box to agree to the waiver."); flag(agree); }

    // Signature
    const sig = form.elements.namedItem("signatureName") as HTMLInputElement | null;
    if (!sig?.value.trim()) { missing.push("Type the full legal name to sign."); flag(sig); }

    // Contact email + mobile (required for everyone).
    const emailEl = form.elements.namedItem("contactEmail") as HTMLInputElement | null;
    const emailV = emailEl?.value.trim() ?? "";
    if (!emailV || !/.+@.+\..+/.test(emailV)) { missing.push(`Enter a valid ${isMinor ? "parent/guardian " : ""}email.`); flag(emailEl); }
    const mobileEl = form.elements.namedItem("contactMobile") as HTMLInputElement | null;
    if ((mobileEl?.value.replace(/\D/g, "").length ?? 0) < 10) { missing.push("Enter a valid mobile number."); flag(mobileEl); }

    // Date of birth for every participant.
    for (const m of participants) {
      const el = form.elements.namedItem(`dob_${m.id}`) as HTMLInputElement | null;
      if (!el?.value) { missing.push(`Enter ${m.name}'s date of birth.`); flag(el); }
    }

    // Emergency contact (required).
    const enEl = form.elements.namedItem("emergencyName") as HTMLInputElement | null;
    if (!enEl?.value.trim()) { missing.push("Enter an emergency contact name."); flag(enEl); }
    const epEl = form.elements.namedItem("emergencyPhone") as HTMLInputElement | null;
    if ((epEl?.value.replace(/\D/g, "").length ?? 0) < 10) { missing.push("Enter a valid emergency contact phone."); flag(epEl); }
    const eeEl = form.elements.namedItem("emergencyEmail") as HTMLInputElement | null;
    const eeV = eeEl?.value.trim() ?? "";
    if (!eeV || !/.+@.+\..+/.test(eeV)) { missing.push("Enter a valid emergency contact email."); flag(eeEl); }

    if (missing.length > 0) {
      setProblems(missing);
      const firstBad = badFields[0];
      if (firstBad) {
        firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
        try { firstBad.focus({ preventScroll: true }); } catch { /* noop */ }
      }
      return;
    }
    setProblems([]);
    setSubmitting(true);
    // Programmatic submit — bypasses the submit event (no re-entry) and any
    // native constraint UI, so it always navigates.
    form.submit();
  };

  return (
    <form ref={formRef} method="POST" action="/api/waiver/sign" noValidate onSubmit={onSubmit} className="card space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="waiverVersion" value={waiverVersion} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
        <WaiverText />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="agree" className="mt-0.5" />
        <span>
          {isMinor ? (
            <>As {personFirstName}&apos;s parent or guardian, I have read, understand, and agree to the{" "}
            <strong>Acknowledgment of Risk, Waiver, and Release of Liability</strong> above, and I sign it on their behalf freely and voluntarily.</>
          ) : (
            <>I have read, understand, and agree to the{" "}
            <strong>Acknowledgment of Risk, Waiver, and Release of Liability</strong> above, and I sign it freely and voluntarily.</>
          )}
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="signatureName">
            {isMinor ? "Parent/guardian signature (type full legal name)" : "Signature (type full legal name)"}
          </label>
          <input id="signatureName" name="signatureName" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="date">Date</label>
          <input id="date" type="date" className="input" defaultValue={today} readOnly />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">
          {participants.length > 1 ? "Everyone on this waiver" : "Participant"}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Date of birth is required{participants.length > 1 ? " for the parent/guardian and each child" : ""}. Gender is optional and helps us place players in the correct division.
        </p>
        <div className="mt-3 space-y-3">
          {participants.map((m) => {
            const g = m.gender === "MALE" || m.gender === "FEMALE" ? m.gender : "";
            return (
              <div key={m.id} className="grid gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-100 sm:grid-cols-[1fr,auto,auto] sm:items-center">
                <div className="text-sm">
                  <span className="font-medium text-slate-800">{m.name}</span>
                  <span className="ml-1.5 text-xs text-slate-400">({m.role})</span>
                </div>
                <div>
                  <label className="sr-only" htmlFor={`dob_${m.id}`}>{m.name} date of birth</label>
                  <input id={`dob_${m.id}`} name={`dob_${m.id}`} type="date" max={today} className="input sm:w-44" defaultValue={m.dob} aria-label={`${m.name} date of birth`} />
                </div>
                <select name={`gender_${m.id}`} className="input sm:w-32" defaultValue={g} aria-label={`${m.name} gender (optional)`}>
                  <option value="">Gender…</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">{isMinor ? "Parent/guardian contact" : "Your contact"}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          We&apos;ll use this to reach {isMinor ? "you" : "you"} about {isMinor ? `${personFirstName}'s ` : "your "}team, schedule, payments, and weekly progress. Both required.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contactEmail">{isMinor ? "Parent/guardian email" : "Email"} *</label>
            <input id="contactEmail" name="contactEmail" type="email" className="input" defaultValue={personEmail} placeholder="you@email.com" />
          </div>
          <div>
            <label className="label" htmlFor="contactMobile">Mobile number *</label>
            <input id="contactMobile" name="contactMobile" type="tel" className="input" defaultValue={personPhone} placeholder="(480) 555-0100" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">Emergency contact</p>
        <p className="mt-0.5 text-xs text-slate-500">Someone we can reach in an emergency at a session. All three are required.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="emergencyName">Name *</label>
            <input id="emergencyName" name="emergencyName" className="input" placeholder="Full name" />
          </div>
          <div>
            <label className="label" htmlFor="emergencyPhone">Phone *</label>
            <input id="emergencyPhone" name="emergencyPhone" type="tel" className="input" placeholder="(480) 555-0100" />
          </div>
          <div>
            <label className="label" htmlFor="emergencyEmail">Email *</label>
            <input id="emergencyEmail" name="emergencyEmail" type="email" className="input" placeholder="name@email.com" />
          </div>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p className="font-semibold">Please finish these before signing:</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Signing…" : "Sign waiver"}</button>
    </form>
  );
}
