import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incident Report" };

// Digital PURE Incident Report. A coach fills it out and submits; the server
// emails it to the team inbox and 303-redirects back to an empty form (so it's
// reset and ready for the next one). Native form POST — no client JS needed.
export default async function IncidentReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  // Prefill the coach's name + phone from their record.
  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId }, select: { firstName: true, lastName: true, phone: true } })
    : null;
  const coachName = me ? `${me.firstName} ${me.lastName}`.trim() : session.name;
  const coachPhone = me?.phone ?? "";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/console/today" className="btn-back">← Today</Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900">Incident Report</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          For injuries, medical events, behavioral incidents, pickup/release issues, facility accidents, safety concerns, or other
          unusual events. <span className="font-medium text-slate-700">Record facts only</span> — what happened immediately before,
          where everyone was, and what actions were taken. Avoid conclusions, blame, or speculation.
        </p>
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          Confidential — this report goes to the Program Director / PURE owners only. Do not share incident details with
          unauthorized persons, including parents/guardians. Serious injuries, suspected abuse or misconduct, missing participants,
          and unauthorized-release concerns must be escalated <strong>immediately</strong> — don&apos;t wait to finish this form.
        </p>
      </header>

      {sp.ok && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <strong>Incident report submitted</strong> and sent to the office. The form below has been reset for another report.
        </div>
      )}
      {sp.err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {sp.err === "fields" ? "Please add at least the incident date and a description." : "Couldn't submit — please try again."}
        </div>
      )}

      <form method="POST" action="/api/console/incident-report" className="space-y-5">
        <input type="hidden" name="ticket" value={ticket} />

        <Section n="1" title="Basic incident information">
          <Grid>
            <Field label="Date of incident" name="incidentDate" type="date" required />
            <Field label="Time" name="incidentTime" type="time" />
            <Field label="Location / court" name="location" />
            <Field label="Program / class" name="program" />
            <Field label="Coach completing report" name="coachName" defaultValue={coachName} required />
            <Field label="Coach phone" name="coachPhone" type="tel" defaultValue={coachPhone} />
          </Grid>
        </Section>

        <Section n="2" title="Person(s) involved">
          <Grid>
            <Field label="Participant name" name="participantName" />
            <Field label="Age" name="participantAge" />
            <Field label="Parent / guardian" name="parentGuardian" />
            <Field label="Phone" name="parentPhone" type="tel" />
            <Field label="Other person involved" name="otherPerson" />
            <Field label="Role" name="otherRole" />
            <YesNo label="Emergency contact called" name="emergencyContactCalled" />
            <Field label="Time contacted" name="timeContacted" type="time" />
          </Grid>
        </Section>

        <Section n="3" title="Type of incident — check all that apply">
          <div className="grid gap-2 sm:grid-cols-2">
            <Check name="type_injury" label="Injury / Illness" />
            <Check name="type_behavioral" label="Behavioral / Conflict" />
            <Check name="type_earlylate" label="Early Arrival / Late Pickup" />
            <Check name="type_unauthorized" label="Unauthorized Pickup / Release" />
            <Check name="type_facility" label="Facility / Equipment" />
            <Check name="type_safesport" label="SafeSport / Boundary Concern" />
            <Check name="type_missing" label="Missing / Unaccounted" />
            <Check name="type_other" label="Other" />
          </div>
          <div className="mt-2">
            <Field label="If other, describe" name="typeOther" />
          </div>
        </Section>

        <Section n="4" title="Description of what happened">
          <label className="label">Describe the sequence of events, location, activity underway, people present, and any relevant conditions</label>
          <textarea name="description" rows={6} required className="input" placeholder="Record facts only…" />
        </Section>

        <Section n="5" title="Injury / medical response (if applicable)">
          <Grid>
            <Field label="Body area / condition" name="bodyArea" />
            <Field label="Visible injury" name="visibleInjury" />
            <YesNo label="First aid provided" name="firstAidProvided" />
            <Field label="By whom" name="firstAidBy" />
            <YesNo label="911 called" name="called911" />
            <Field label="Time" name="called911Time" type="time" />
            <YesNo label="EMS / Fire responded" name="emsResponded" />
            <YesNo label="Transported" name="transported" />
            <Select label="Medication used" name="medicationUsed" options={["", "None", "EpiPen", "Inhaler", "Other"]} />
            <YesNo label="Parent notified" name="parentNotifiedMedical" />
          </Grid>
        </Section>

        <Section n="6" title="Supervision / pickup details (if applicable)">
          <Grid>
            <Field label="Scheduled start / end" name="scheduledStartEnd" />
            <Field label="Actual arrival / pickup" name="actualArrivalPickup" />
            <Field label="Approved pickup person" name="approvedPickup" />
            <Select label="Code / ID verified" name="codeIdVerified" options={["", "Yes", "No", "N/A"]} />
            <Field label="Parent contact attempts" name="parentContactAttempts" />
            <Field label="Staff escalated to" name="staffEscalatedTo" />
            <Field label="Participant released to" name="participantReleasedTo" />
            <Field label="Time released" name="timeReleased" type="time" />
          </Grid>
        </Section>

        <Section n="7" title="Witnesses">
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-3">
                <Field label={`Witness ${i} name`} name={`w${i}Name`} />
                <Field label="Relationship / role" name={`w${i}Rel`} />
                <Field label="Phone / email" name={`w${i}Contact`} />
              </div>
            ))}
          </div>
        </Section>

        <Section n="8" title="Actions taken / immediate follow-up">
          <div className="grid gap-2 sm:grid-cols-2">
            <Check name="act_parentNotified" label="Parent/guardian notified" />
            <Check name="act_directorNotified" label="Program Director / Manager notified" />
            <Check name="act_firstAid" label="First aid / EMS provided" />
            <Check name="act_removed" label="Participant removed from activity" />
            <Check name="act_equipmentOOS" label="Equipment/court taken out of service" />
            <Check name="act_safesportInitiated" label="SafeSport / misconduct report initiated if required" />
          </div>
          <div className="mt-3">
            <label className="label">Additional action taken / instructions given</label>
            <textarea name="additionalActions" rows={3} className="input" />
          </div>
        </Section>

        <Section n="9" title="Coach certification">
          <p className="mb-3 text-xs text-slate-500">
            I certify that this report is accurate to the best of my knowledge and reflects the facts known to me when completed.
            Serious injuries, suspected abuse or misconduct, missing participants, unauthorized-release concerns, and other
            significant safety matters must be escalated immediately and should not wait for completion of this form.
          </p>
          <Grid>
            <Field label="Coach printed name" name="coachPrintedName" defaultValue={coachName} required />
            <Field label="Date" name="certDate" type="date" required />
            <Field label="Signature (type your full name)" name="coachSignature" defaultValue={coachName} required />
          </Grid>
        </Section>

        <div className="flex items-center justify-end gap-3 pb-6">
          <button className="btn-primary">Submit incident report</button>
        </div>
      </form>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-3 border-b border-slate-100 pb-2 text-sm font-bold uppercase tracking-wide text-brand-800">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, name, type = "text", required = false, defaultValue }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-rose-500"> *</span>}</label>
      <input name={name} type={type} required={required} defaultValue={defaultValue} className="input" />
    </div>
  );
}

function Select({ label, name, options }: { label: string; name: string; options: string[] }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select name={name} className="input" defaultValue="">
        {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    </div>
  );
}

function YesNo({ label, name }: { label: string; name: string }) {
  return <Select label={label} name={name} options={["", "Yes", "No"]} />;
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
      <input type="checkbox" name={name} value="1" className="accent-brand-600" />
      {label}
    </label>
  );
}
