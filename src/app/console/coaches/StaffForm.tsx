"use client";

import type { Role } from "@/lib/enums";

export function StaffForm({ role, ticket }: { role: Role; ticket: string }) {
  void role;
  return (
    <div className="card">
      <h2 className="font-semibold text-brand-900">Add a staff or coach login</h2>
      <p className="mt-1 text-sm text-slate-500">
        Creates a console account. Share the password securely — the person can change
        it after signing in.
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
        <div>
          <label className="label">Initial password</label>
          <input name="password" type="password" minLength={8} className="input" required />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full">
            Create account
          </button>
        </div>
      </form>
    </div>
  );
}
