"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/Brand";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, {});

  // Full-page navigation once the session cookie is set, so the browser sends it.
  useEffect(() => {
    if (state?.redirect) window.location.assign(state.redirect);
  }, [state]);

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card">
          <h1 className="text-xl font-bold text-slate-900">Member login</h1>
          <p className="mt-1 text-sm text-slate-500">
            Players, parents, coaches, and staff.
          </p>
          <form action={action} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
            </div>
            {state?.error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {state.error}
              </p>
            )}
            <button type="submit" disabled={pending} className="btn-primary w-full">
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-slate-500">
          New to PURE?{" "}
          <Link href="/register" className="font-semibold text-brand-700">
            Register for the season
          </Link>
        </p>
      </div>
    </div>
  );
}
