"use client";

// A family edits their own or a dependent's details from the portal — contact,
// address, two emergency contacts, and medical notes. Collapsed by default so
// the portal stays a glance; posts to the portal API, which scopes the change to
// the household and encrypts the sensitive fields.
export type PortalPerson = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  dob: string; // YYYY-MM-DD
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  emergencyName2: string;
  emergencyRelation2: string;
  emergencyPhone2: string;
  medical: string;
};

export function PortalPersonForm({ ticket, person, isSelf }: { ticket: string; person: PortalPerson; isSelf: boolean }) {
  return (
    <details className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{person.firstName} {person.lastName}{isSelf ? " (you)" : ""}</span>
        <span className="inline-flex items-center rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">Edit info</span>
      </summary>
      <form method="POST" action="/api/portal" className="mt-3 space-y-4">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="updatePerson" />
        <input type="hidden" name="targetId" value={person.id} />

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div><label className="label">First name</label><input name="firstName" defaultValue={person.firstName} className="input" /></div>
            <div><label className="label">Last name</label><input name="lastName" defaultValue={person.lastName} className="input" /></div>
            <div><label className="label">Email</label><input name="email" type="email" defaultValue={person.email} className="input" /></div>
            <div><label className="label">Mobile</label><input name="phone" type="tel" defaultValue={person.phone} className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Address</label><input name="address" defaultValue={person.address} className="input" /></div>
            <div><label className="label">Date of birth</label><input name="dob" type="date" defaultValue={person.dob} className="input" /></div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency contact 1</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div><label className="label">Name</label><input name="emergencyName" defaultValue={person.emergencyName} className="input" /></div>
            <div><label className="label">Relationship</label><input name="emergencyRelation" defaultValue={person.emergencyRelation} className="input" /></div>
            <div><label className="label">Phone</label><input name="emergencyPhone" type="tel" defaultValue={person.emergencyPhone} className="input" /></div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency contact 2</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div><label className="label">Name</label><input name="emergencyName2" defaultValue={person.emergencyName2} className="input" /></div>
            <div><label className="label">Relationship</label><input name="emergencyRelation2" defaultValue={person.emergencyRelation2} className="input" /></div>
            <div><label className="label">Phone</label><input name="emergencyPhone2" type="tel" defaultValue={person.emergencyPhone2} className="input" /></div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Medical notes</div>
          <p className="mt-1 text-xs text-slate-500">Allergies or conditions your coach should know. Kept private to staff.</p>
          <textarea name="medicalNotes" rows={2} defaultValue={person.medical} className="input mt-2 w-full" />
        </div>

        <div className="flex justify-end">
          <button className="btn-primary text-sm">Save details</button>
        </div>
      </form>
    </details>
  );
}
