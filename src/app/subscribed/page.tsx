import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

// Branded newsletter-confirmation landing page. Point Zoho Campaigns'
// post-confirmation redirect here (Signup form → after-confirmation URL) so
// subscribers land on our own site instead of Zoho's default confirm page.
export const metadata: Metadata = {
  title: "You're subscribed",
  description: "You're on the PURE Pickleball & Padel list.",
  robots: { index: false },
};

export default function SubscribedPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">✓</div>
        <h1 className="display mt-6 text-3xl text-brand-900 sm:text-4xl">You&apos;re all set!</h1>
        <p className="mt-3 text-slate-600">
          Your email is confirmed — you&apos;re on the list. Keep an eye on your inbox for news, events, and updates from
          PURE Pickleball &amp; Padel.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="btn-primary">Enroll in the Academy</Link>
          <Link href="/" className="btn-secondary">Back home</Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
