"use client";

// Create/edit form for a licensed organization (tenant). Native POST to the
// organizations route with a signed ticket; used for both create (no org) and
// edit (org prefilled). Kept deliberately plain — this is a super-admin tool.

export type OrgFormValues = {
  id?: string;
  slug?: string;
  name?: string;
  legalName?: string | null;
  status?: string;
  primaryHost?: string | null;
  logoUrl?: string | null;
  secondaryLogoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  smsBrand?: string | null;
  timezone?: string | null;
  currency?: string | null;
  isPrimary?: boolean;
};

function Field({ label, name, defaultValue, placeholder, type = "text", hint, required }: {
  label: string; name: string; defaultValue?: string | null; placeholder?: string; type?: string; hint?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}{required ? " *" : ""}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="input" required={required} />
      {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function OrgForm({ ticket, org }: { ticket: string; org?: OrgFormValues }) {
  const editing = !!org?.id;
  const primary = !!org?.isPrimary;
  return (
    <form method="POST" action="/api/console/organizations" className="space-y-6">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={editing ? "update" : "create"} />
      {editing && <input type="hidden" name="id" value={org!.id} />}

      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" defaultValue={org?.name} placeholder="Northwood School Pickleball" required />
          <Field label="Slug" name="slug" defaultValue={org?.slug} placeholder="northwood" hint={primary ? "Primary org — slug is locked." : "URL-safe; also the default subdomain (slug.yourapp.com)."} />
          <Field label="Legal name" name="legalName" defaultValue={org?.legalName} placeholder="Northwood School District" />
          <label className="block">
            <span className="label">Status</span>
            <select name="status" defaultValue={org?.status ?? "ACTIVE"} className="input" disabled={primary}>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            {primary && <span className="mt-0.5 block text-xs text-slate-400">The primary org is always active.</span>}
          </label>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Domain</h2>
        <Field label="Primary domain" name="primaryHost" defaultValue={org?.primaryHost} placeholder="portal.northwood.edu" hint="The custom hostname this org is served on. Leave blank to use slug.yourapp.com. Point the domain's DNS at the platform first." />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Branding</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Logo URL" name="logoUrl" defaultValue={org?.logoUrl} placeholder="/brand/… or https://…" hint="Shown in the app chrome and emails." />
          <Field label="Secondary logo URL" name="secondaryLogoUrl" defaultValue={org?.secondaryLogoUrl} placeholder="optional co-brand mark" />
          <Field label="Favicon URL" name="faviconUrl" defaultValue={org?.faviconUrl} placeholder="optional" />
          <div />
          <Field label="Primary color (hex)" name="primaryColor" defaultValue={org?.primaryColor} placeholder="#2c4670" />
          <Field label="Accent color (hex)" name="accentColor" defaultValue={org?.accentColor} placeholder="#a9d329" />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Communications identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From name" name="fromName" defaultValue={org?.fromName} placeholder="Northwood Pickleball" hint="Sender name on outbound email." />
          <Field label="From email" name="fromEmail" type="email" defaultValue={org?.fromEmail} placeholder="team@northwood.edu" />
          <Field label="Support email" name="supportEmail" type="email" defaultValue={org?.supportEmail} placeholder="help@northwood.edu" />
          <Field label="Support phone" name="supportPhone" defaultValue={org?.supportPhone} placeholder="optional" />
          <Field label="SMS brand" name="smsBrand" defaultValue={org?.smsBrand} placeholder="Northwood" hint="Prefixed on outbound texts." />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Timezone" name="timezone" defaultValue={org?.timezone ?? "America/Phoenix"} placeholder="America/Phoenix" />
            <Field label="Currency" name="currency" defaultValue={org?.currency ?? "usd"} placeholder="usd" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <a href="/console/organizations" className="btn-secondary text-sm">Cancel</a>
        <button className="btn-primary text-sm">{editing ? "Save changes" : "Create organization"}</button>
      </div>
    </form>
  );
}
