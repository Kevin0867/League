import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ waitlist?: string; full?: string; placed?: string }>;
}) {
  const { waitlist, full, placed } = await searchParams;
  // A team fill-link that filled up before this person finished → waitlisted for
  // that specific team, no charge.
  const isTeamFull = full === "1";
  // Fee-waived recruit placed on a team (nothing to pay).
  const isPlaced = placed === "1";
  const isWaitlist = waitlist === "1" || isTeamFull;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl ${isWaitlist ? "bg-amber-100" : "bg-emerald-100"}`}>
          {isWaitlist ? "★" : "✓"}
        </div>
        <h1 className="display mt-6 text-3xl text-brand-900 sm:text-4xl">
          {isTeamFull ? "That spot just filled" : isWaitlist ? "You're on the waitlist" : isPlaced ? "You're on the team!" : "Registration received"}
        </h1>
        {isTeamFull ? (
          <p className="mt-3 text-slate-600">
            Someone grabbed the last spot on that team just before you finished, so
            we&apos;ve added you to its <strong>waitlist</strong>. If a spot reopens,
            the Academy Director will reach out — and <strong>you haven&apos;t been
            charged</strong>. We&apos;ve emailed you a confirmation.
          </p>
        ) : isPlaced ? (
          <p className="mt-3 text-slate-600">
            You&apos;re all set and placed on your team — welcome! We&apos;ve emailed
            you a confirmation with your team, day, time, and location.
          </p>
        ) : isWaitlist ? (
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
