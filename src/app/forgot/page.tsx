import Link from "next/link";
import { Logo } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card">
          <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
          {sent ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                If an account exists for that email, we&apos;ve sent a reset link. It
                expires in 1 hour. Check your inbox (and spam).
              </p>
              <Link href="/login" className="btn-primary mt-4">Back to sign in</Link>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-500">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form method="POST" action="/api/auth/forgot" className="mt-5 space-y-4">
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" autoComplete="email" required className="input" />
                </div>
                <button type="submit" className="btn-primary w-full">Send reset link</button>
              </form>
              <Link href="/login" className="mt-4 inline-block text-sm text-brand-700">
                ← Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
