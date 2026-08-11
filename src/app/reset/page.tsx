import Link from "next/link";
import { Logo, PadelLogo } from "@/components/Brand";
import { PasswordField } from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; invite?: string }>;
}) {
  const { token, error, invite } = await searchParams;
  const invalid = error === "invalid" || !token;
  const message =
    error === "short" ? "Password must be at least 8 characters." : error === "mismatch" ? "Passwords don't match." : null;
  const isInvite = invite === "1";

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <PadelLogo className="h-9" />
        </div>
        <div className="card">
          <h1 className="text-xl font-bold text-slate-900">{isInvite ? "Welcome — set your password" : "Set a new password"}</h1>
          {isInvite && !invalid && (
            <p className="mt-1 text-sm text-slate-500">Create a password to activate your PURE Academy Console access.</p>
          )}
          {invalid ? (
            <>
              <p className="mt-2 text-sm text-rose-700">
                This {isInvite ? "invite" : "reset"} link is invalid or has expired. Request a new one.
              </p>
              <Link href="/forgot" className="btn-primary mt-4">Request a new link</Link>
            </>
          ) : (
            <form method="POST" action="/api/auth/reset" className="mt-5 space-y-4">
              <input type="hidden" name="token" value={token} />
              <PasswordField name="password" label="New password" confirm hint="At least 8 characters." />
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
