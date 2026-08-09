"use client";

import { useActionState } from "react";
import { createStaff } from "./actions";
import type { Role } from "@/lib/enums";

export function StaffForm({ role }: { role: Role }) {
  const [state, action, pending] = useActionState(createStaff, {});
  const isCOO = role === "COO";
  return (
    <div className="card">
      <h2 className="font-semibold text-brand-900">Add a staff or coach login</h2>
      <p className="mt-1 text-sm text-slate-500">
        Creates a console account. Share the password securely — the person can change
        it after signing in.
      </p>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
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
            {isCOO && <option value="DIRECTOR">Director</option>}
            {isCOO && <option value="CEO">CEO</option>}
          </select>
        </div>
        <div>
          <label className="label">Initial password</label>
          <input name="password" type="password" minLength={8} className="input" required />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
      {state?.error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      )}
      {state?.ok && (
        <p className="mt-3 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{state.ok}</p>
      )}
    </div>
  );
}
