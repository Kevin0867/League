import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { SMS_CONSENT_TEXT, EMAIL_CONSENT_TEXT } from "@/lib/consent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Email & Text Opt-In — PURE Academy" },
  description: "Opt in to receive email and text message updates from PURE Pickleball & Padel.",
  alternates: { canonical: "/opt-in" },
};

const ERRORS: Record<string, string> = {
  name: "Please enter your name.",
  none: "Please check at least one box to opt in.",
  email: "Enter a valid email to opt in to email.",
  phone: "Enter a valid mobile number to opt in to texts.",
};

export default async function OptInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-12">
        <p className="eyebrow">Stay in the loop</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">Email &amp; text opt-in</h1>
        <p className="mt-2 text-slate-600">
          Get season updates, schedules, practice reminders, and account notifications from{" "}
          <span className="font-medium">PURE Pickleball &amp; Padel</span>. You choose which channels, and you can opt
          out anytime.
        </p>

        {sp.ok ? (
          <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
            <p className="font-semibold">You&apos;re opted in — thank you!</p>
            <p className="mt-1">
              You can opt out anytime: reply <strong>STOP</strong> to any text, or use the unsubscribe link in any
              email.
            </p>
          </div>
        ) : (
          <form method="POST" action="/api/opt-in" className="mt-8 space-y-5">
            {sp.err && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Please check the form."}</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="name">Name *</label>
                <input id="name" name="name" className="input" required />
              </div>
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input id="email" name="email" type="email" className="input" placeholder="you@example.com" />
              </div>
              <div>
                <label className="label" htmlFor="phone">Mobile number</label>
                <input id="phone" name="phone" type="tel" className="input" placeholder="(602) 555-0123" />
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name="emailOptIn" className="mt-0.5 h-4 w-4" />
                <span className="text-slate-700">{EMAIL_CONSENT_TEXT}</span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name="smsOptIn" className="mt-0.5 h-4 w-4" />
                <span className="text-slate-700">{SMS_CONSENT_TEXT}</span>
              </label>
            </div>

            <p className="text-xs text-slate-500">
              By submitting, you agree to the boxes you checked above. See our{" "}
              <Link href="/privacy" className="text-brand-700 hover:underline">Privacy Policy</Link> and{" "}
              <Link href="/terms" className="text-brand-700 hover:underline">Terms of Service</Link>. Consent is not a
              condition of any purchase.
            </p>

            <button className="btn-primary">Opt in</button>
          </form>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
