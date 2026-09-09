import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found" };

// Branded 404 — reached when a page or record no longer exists (e.g. a bookmark
// to a practice that was later deleted or cancelled). Points people back to
// somewhere real rather than a bare browser error.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">PURE Academy</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">This page isn&apos;t here</h1>
        <p className="mt-3 text-slate-600">
          The page or item you were looking for may have been moved, cancelled, or removed. It happens — a
          practice gets deleted, or a link goes stale.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/console" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Go to the console
          </Link>
          <Link href="/portal" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            My portal
          </Link>
        </div>
      </div>
    </main>
  );
}
