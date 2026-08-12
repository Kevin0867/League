import { personContacts, defaultReportSelection, allSelection, type ContactPerson } from "@/lib/domain/contacts";

// A "Send to" checklist of a person's labeled email addresses (and their
// guardian's, for a minor). Plain native checkboxes — works inside any form
// without client JS; the checked addresses submit under `name` (default "to").
// purpose="report" defaults to parents/guardians only (never a minor's own
// address); purpose="all" defaults to every address on file.
export function RecipientChecklist({
  person,
  guardian,
  purpose = "all",
  name = "to",
  legend = "Send to",
}: {
  person: ContactPerson;
  guardian?: ContactPerson | null;
  purpose?: "report" | "all";
  name?: string;
  legend?: string;
}) {
  const contacts = personContacts(person, guardian);
  if (contacts.length === 0) {
    return (
      <p className="text-sm text-rose-600">
        No email on file — add a parent/guardian or student email on the player&apos;s record first.
      </p>
    );
  }
  const defaults = purpose === "report" ? defaultReportSelection(contacts, person) : allSelection(contacts);
  return (
    <fieldset className="space-y-1.5">
      <legend className="label mb-1">{legend}</legend>
      {contacts.map((c) => (
        <label key={c.email} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-slate-50">
          <input type="checkbox" name={name} value={c.email} defaultChecked={defaults.has(c.email)} className="h-4 w-4" />
          <span className="font-medium text-slate-800">{c.name}</span>
          {c.source === "guardian" && <span className="badge bg-brand-50 text-brand-700">guardian</span>}
          <span className="text-slate-400">· {c.email}</span>
        </label>
      ))}
    </fieldset>
  );
}
