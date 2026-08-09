"use client";

import { useActionState, useEffect } from "react";
import { createFirstAdmin } from "./actions";

export function SetupForm({ needsToken }: { needsToken: boolean }) {
  const [state, action, pending] = useActionState(createFirstAdmin, {});

  useEffect(() => {
    if (state?.redirect) window.location.assign(state.redirect);
  }, [state]);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" required className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={8} className="input" />
      </div>
      {needsToken && (
        <div>
          <label className="label" htmlFor="token">Setup token</label>
          <input id="token" name="token" required className="input" />
        </div>
      )}
      {state?.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Creating…" : "Create administrator & sign in"}
      </button>
    </form>
  );
}
