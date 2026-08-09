import Link from "next/link";
import { Logo } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const invalid = error === "invalid" || !token;
  const message = error === "short" ? "Password must be at least 8 characters." : null;

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card">
          <h1 className="text-xl font-bold text-slate-900">Set a new password</h1>
          {invalid ? (
            <>
              <p className="mt-2 text-sm text-rose-700">
                This reset link is invalid or has expired. Request a new one.
              </p>
              <Link href="/forgot" className="btn-primary mt-4">Request a new link</Link>
            </>
          ) : (
            <form method="POST" action="/api/auth/reset" className="mt-5 space-y-4">
              <input type="hidden" name="token" value={token} />
              <div>
                <label className="label" htmlFor="password">New password</label>
                <input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required className="input" />
                <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
              </div>
              {message && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
              )}
              <button type="submit" className="btn-primary w-full">Set password &amp; sign in</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
