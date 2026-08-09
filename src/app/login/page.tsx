import Link from "next/link";
import { Logo } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    error === "invalid"
      ? "Invalid email or password."
      : error === "missing"
      ? "Email and password are required."
      : error === "locked"
      ? "Too many attempts. This account is locked for 15 minutes — or reset your password."
      : null;

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
          {/* Native form POST → route handler sets the session cookie reliably. */}
          <form method="POST" action="/api/auth/login" className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
            </div>
            {message && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
            )}
            <button type="submit" className="btn-primary w-full">Sign in</button>
          </form>
          <div className="mt-4 text-center">
            <Link href="/forgot" className="text-sm text-brand-600 hover:text-brand-800">
              Forgot your password?
            </Link>
          </div>
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
