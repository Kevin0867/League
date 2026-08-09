import Link from "next/link";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Brand";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const userCount = await prisma.user.count().catch(() => -1);
  const needsToken = !!process.env.SETUP_TOKEN;

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
              <SetupForm needsToken={needsToken} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
