"use client";

import type { Role } from "@/lib/enums";

export function StaffForm({ role, ticket }: { role: Role; ticket: string }) {
  void role;
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-brand-900">Invite a coach</summary>
      <p className="mt-1 text-sm text-slate-500">
        Creates their console account and emails a secure link to set their own password —
        no shared passwords. You&apos;ll land on their profile to fill in the rest.
      </p>
      <form method="POST" action="/api/console/coaches" className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="create" />
        <div>
          <label className="label">First name</label>
          <input name="firstName" className="input" required />
        </div>
        <div>
          <label className="label">Last name</label>
          <input name="lastName" className="input" required />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" className="input" required />
        </div>
        <div>
          <label className="label">Role</label>
          <select name="role" className="input" defaultValue="COACH">
            <option value="COACH">Coach</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary w-full sm:w-auto">
            Send invite
          </button>
        </div>
      </form>
    </details>
  );
}
