import Link from "next/link";

// Site-wide footer: contact route + the legal pages required for a site that
// takes payment and collects minors' data (§ build-list item 5).
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-sm font-extrabold uppercase tracking-wide text-brand-900">PURE Academy</div>
          <p className="mt-2 text-sm text-slate-500">
            Team-based pickleball training across the Phoenix Valley.
          </p>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contact</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li><a href="mailto:team@purepickleball.com" className="hover:text-brand-700 hover:underline">team@purepickleball.com</a></li>
            <li><a href="tel:+12085695500" className="hover:text-brand-700 hover:underline">208.569.5500</a></li>
            <li><a href="https://purepickleball.com" className="hover:text-brand-700 hover:underline">purepickleball.com</a></li>
            <li><a href="https://instagram.com/purepickleballusa" className="hover:text-brand-700 hover:underline">@purepickleballusa</a></li>
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Legal</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li><Link href="/terms" className="hover:text-brand-700 hover:underline">Terms of Service</Link></li>
            <li><Link href="/privacy" className="hover:text-brand-700 hover:underline">Privacy Policy</Link></li>
            <li><Link href="/season-terms" className="hover:text-brand-700 hover:underline">Season Terms &amp; Refund Policy</Link></li>
            <li><Link href="/opt-in" className="hover:text-brand-700 hover:underline">Email &amp; text opt-in</Link></li>
            <li><a href="/waiver.pdf" className="hover:text-brand-700 hover:underline">Participation waiver (PDF)</a></li>
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">League</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li><Link href="/teams" className="hover:text-brand-700 hover:underline">Our Teams</Link></li>
            <li><Link href="/standings" className="hover:text-brand-700 hover:underline">Standings</Link></li>
            <li><Link href="/schedule" className="hover:text-brand-700 hover:underline">Schedule</Link></li>
            <li><Link href="/acp" className="hover:text-brand-700 hover:underline">Play in ACP</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400">
        © 2026 PURE Pickleball &amp; Padel · Arizona Club Pickleball
      </div>
    </footer>
  );
}
