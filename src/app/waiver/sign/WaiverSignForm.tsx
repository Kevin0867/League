"use client";

import { useRef, useState } from "react";
import { WaiverText } from "@/components/WaiverText";

type Participant = { id: string; name: string; gender: string | null; role: string };

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

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
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

    // Gender for every participant
    for (const m of participants) {
      const sel = form.elements.namedItem(`gender_${m.id}`) as HTMLSelectElement | null;
      const v = sel?.value ?? "";
      if (v !== "MALE" && v !== "FEMALE") { missing.push(`Select a gender for ${m.name}.`); flag(sel); }
    }

    // Guardian email (minors only)
    if (isMinor) {
      const ge = form.elements.namedItem("guardianEmail") as HTMLInputElement | null;
      const v = ge?.value.trim() ?? "";
      if (!v || !/.+@.+\..+/.test(v)) { missing.push("Enter a valid parent/guardian email."); flag(ge); }
    }

    if (missing.length > 0) {
      e.preventDefault();
      setProblems(missing);
      const firstBad = badFields[0];
      if (firstBad) {
        firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
        try { firstBad.focus({ preventScroll: true }); } catch { /* noop */ }
      }
      return;
    }
    setProblems([]);
    // valid → allow the native POST to proceed
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
          Please confirm each person&apos;s gender — it&apos;s used to place players in the correct
          division{participants.length > 1 ? ", including the parent/guardian and each child" : ""}.
        </p>
        <div className="mt-3 space-y-3">
          {participants.map((m) => {
            const g = m.gender === "MALE" || m.gender === "FEMALE" ? m.gender : "";
            return (
              <div key={m.id} className="grid grid-cols-[1fr,auto] items-center gap-3">
                <div className="text-sm">
                  <span className="font-medium text-slate-800">{m.name}</span>
                  <span className="ml-1.5 text-xs text-slate-400">({m.role})</span>
                </div>
                <select name={`gender_${m.id}`} className="input w-40" defaultValue={g}>
                  <option value="">Select…</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {isMinor && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Parent/guardian contact</p>
          <p className="mt-0.5 text-xs text-slate-500">
            We&apos;ll use this to reach you about {personFirstName}&apos;s team, schedule, payments, and weekly
            progress. Required.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="guardianEmail">Parent/guardian email *</label>
              <input id="guardianEmail" name="guardianEmail" type="email" className="input"
                defaultValue={personEmail} placeholder="parent@email.com" />
            </div>
            <div>
              <label className="label" htmlFor="guardianPhone">Parent/guardian phone (optional)</label>
              <input id="guardianPhone" name="guardianPhone" type="tel" className="input"
                defaultValue={personPhone} placeholder="(480) 555-0100" />
            </div>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p className="font-semibold">Please finish these before signing:</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <button type="submit" className="btn-primary">Sign waiver</button>
    </form>
  );
}
