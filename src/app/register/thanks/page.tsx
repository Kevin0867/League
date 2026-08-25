import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ waitlist?: string }>;
}) {
  const { waitlist } = await searchParams;
  const isWaitlist = waitlist === "1";

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl ${isWaitlist ? "bg-amber-100" : "bg-emerald-100"}`}>
          {isWaitlist ? "★" : "✓"}
        </div>
        <h1 className="display mt-6 text-3xl text-brand-900 sm:text-4xl">
          {isWaitlist ? "You're on the waitlist" : "Registration received"}
        </h1>
        {isWaitlist ? (
          <p className="mt-3 text-slate-600">
            Registration has closed, so we&apos;ve added you to the waitlist. If a spot
            opens up, the Academy Director will reach out to place you on a team.
            There&apos;s nothing more to do for now — and no payment is due unless
            you&apos;re placed. We&apos;ve emailed you a confirmation.
          </p>
        ) : (
          <p className="mt-3 text-slate-600">
            Thanks! You&apos;re on the list. The Academy Director will place you on a
            team after the Week-1 assessment. We&apos;ll email you your team, coach,
            location, day, and time — and only then request the season fee.
          </p>
        )}
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="btn-primary">Log in to your portal</Link>
          <Link href="/" className="btn-secondary">Back home</Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
