import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { acpEntryWindow } from "@/lib/domain/acpEntry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Play in ACP — Arizona Club Pickleball" },
  description: "Enter your club team in a DUPR-recorded league. $195 per player. Entries open September 14 and close October 12.",
  alternates: { canonical: "/acp" },
};

export default async function AcpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const window = acpEntryWindow();

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="eyebrow">Arizona Club Pickleball</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
          Bring your club into a <em className="text-accent-600">DUPR-recorded</em> league
        </h1>
        <p className="mt-3 text-slate-600">
          Arizona Club Pickleball is a DUPR-recorded league — every game counts toward player ratings.
        </p>

        <ul className="mt-6 space-y-3 text-sm text-slate-700">
          {[
            "Doubles only. Three ranked lines per match, best of three games to 11, traditional scoring, win by 2. Switch ends at 6 in a third game. A team of eight plays an exhibition fourth line that does not count toward the result.",
            "League runs five weeks from the week of October 26. Championships the week of December 7–13.",
            "No coach required — a team names a team contact, a captain or organizer.",
            "Divisions: youth by school level; adults by DUPR band. Minimum four teams per division.",
            "Six to eight players per team.",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {/* Phase B: entries are open — go straight to the entry form. */}
        {window === "open" && (
          <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold text-emerald-900">Entries are open</h2>
              <span className="text-sm font-medium text-emerald-700">$195 per player</span>
            </div>
            <p className="mt-1 text-sm text-emerald-800">
              Enter your club team now — name a team contact, list 6–8 players, and pay by the secure link we email
              you. Entries close <strong>October 12</strong>; the league begins the week of <strong>October 26</strong>.
            </p>
            <Link href="/acp/enter" className="btn-primary mt-4 inline-block">Enter your team →</Link>
          </div>
        )}

        {/* After the window: entries closed. */}
        {window === "closed" && (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-bold text-slate-900">Entries are closed</h2>
            <p className="mt-1 text-sm text-slate-600">
              Entries closed October 12 and the league is underway. Want in next season?{" "}
              <a href="mailto:stephanie@purepickleball.com" className="font-medium text-brand-700 hover:underline">Email us</a>{" "}
              and we&apos;ll add you to the list.
            </p>
          </div>
        )}

        {/* Phase A: before entries open — interest capture. */}
        {window === "before" && (
        <div className="mt-10 rounded-2xl border border-brand-200 bg-brand-50/50 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold text-brand-900">Entries open September 14</h2>
            <span className="text-sm font-medium text-slate-500">$195 per player</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Entries open <strong>September 14</strong>, close <strong>October 12</strong>, and the league begins the
            week of <strong>October 26</strong>. Tell us you&apos;re interested and we&apos;ll email you the moment
            entries open.
          </p>

          {sp.ok ? (
            <div className="mt-5 rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              You&apos;re on the list — we&apos;ve emailed you the dates and we&apos;ll be in touch when entries open
              on September 14.
            </div>
          ) : (
            <form method="POST" action="/api/acp/interest" className="mt-5 grid gap-3 sm:grid-cols-2">
              {sp.err && (
                <p className="sm:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Please enter your club name, your name, and a valid email.
                </p>
              )}
              <div>
                <label className="label">Club name *</label>
                <input name="clubName" className="input" required />
              </div>
              <div>
                <label className="label">Your name *</label>
                <input name="contactName" className="input" required />
              </div>
              <div>
                <label className="label">Email *</label>
                <input name="email" type="email" className="input" required />
              </div>
              <div>
                <label className="label">Phone</label>
                <input name="phone" type="tel" className="input" />
              </div>
              <div>
                <label className="label">Market / city</label>
                <input name="market" className="input" placeholder="e.g. Scottsdale" />
              </div>
              <div>
                <label className="label">Likely # of teams</label>
                <input name="likelyTeams" type="number" min={1} className="input" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Which divisions might you enter?</label>
                <input name="likelyDivisions" className="input" placeholder="e.g. Women's 3.5, Men's 4.0" />
              </div>
              <div className="sm:col-span-2">
                <button className="btn-primary w-full sm:w-auto">Tell us you&apos;re interested</button>
              </div>
            </form>
          )}
        </div>
        )}

        <p className="mt-6 text-xs text-slate-400">
          PURE Academy runs its own team season first (September 14 start). ACP outside-club entries open once the
          season is underway.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
