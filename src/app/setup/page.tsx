import Link from "next/link";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Brand";
import { PasswordField } from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const userCount = await prisma.user.count().catch(() => -1);
  const needsToken = !!process.env.SETUP_TOKEN;

  const message =
    error === "fields"
      ? "All fields are required."
      : error === "short"
      ? "Password must be at least 8 characters."
      : error === "mismatch"
      ? "Passwords don't match."
      : error === "token"
      ? "Invalid setup token."
      : null;

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 to-white px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card">
          {userCount === -1 ? (
            <p className="text-sm text-rose-700">
              Can&apos;t reach the database. Check that migrations have run and the
              connection strings are set.
            </p>
          ) : userCount > 0 ? (
            <>
              <h1 className="text-xl font-bold text-brand-900">Setup complete</h1>
              <p className="mt-2 text-sm text-slate-600">
                An administrator already exists. This page is now locked.
              </p>
              <Link href="/login" className="btn-primary mt-4">Go to sign in</Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-brand-900">Create the first administrator</h1>
              <p className="mt-1 text-sm text-slate-500">
                This creates the Chief Operating Officer account with full access.
                Do this once, right after deploying.
              </p>
              <form method="POST" action="/api/setup" className="mt-5 space-y-4">
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
                <PasswordField name="password" label="Password" confirm hint="At least 8 characters." />
                {needsToken && (
                  <div>
                    <label className="label" htmlFor="token">Setup token</label>
                    <input id="token" name="token" required className="input" />
                  </div>
                )}
                {message && (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
                )}
                <button type="submit" className="btn-primary w-full">
                  Create administrator &amp; sign in
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
