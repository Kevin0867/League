// Mirror of the purepickleball.com top nav (the Replit-hosted parent site), so
// the academy app wears the same site-wide header and feels like one continuous
// site. Every link points back to purepickleball.com with an absolute URL —
// except "PURE Academy", which is this app's own home. Brand tokens match the
// parent site exactly (green #8ab800/#729a00, navy #0a1628, gray-blue #4a5878).

const SITE = "https://purepickleball.com";

// Marketing links — all navigate back to the parent site, matching the
// purepickleball.com nav exactly (PURE Academy → its parent-site landing page,
// keeping the two navs identical no matter which site the visitor is on).
const LINKS: { label: string; href: string }[] = [
  { label: "Home", href: `${SITE}/` },
  { label: "PURE Academy", href: `${SITE}/academy` },
  { label: "Arizona High School Pickleball", href: `${SITE}/highschool` },
  { label: "News", href: `${SITE}/news` },
  { label: "Pro Shop", href: `${SITE}/shop/` },
  { label: "Contact Us", href: `${SITE}/contact` },
];

const linkCls = "font-semibold text-[0.75rem] tracking-widest uppercase text-[#4a5878] hover:text-[#0a1628]";
const btnCls = "font-semibold text-[0.75rem] tracking-widest uppercase px-4 py-2 bg-[#8ab800] text-white hover:bg-[#729a00] transition-colors";

export function SiteHeader() {
  return (
    <div
      className="flex items-center justify-between px-6 md:px-10 h-[60px]"
      style={{ background: "rgba(244,245,247,0.97)", backdropFilter: "blur(12px)", borderBottom: "1px solid #d8dde8" }}
    >
      <a href={`${SITE}/`} className="flex-shrink-0">
        {/* Hosted in the app so it can't break on the parent site's asset paths. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pure-pickleball-padel.png" alt="PURE Pickleball & Padel" className="h-9 w-auto" />
      </a>

      {/* Desktop nav */}
      <ul className="hidden items-center gap-5 lg:flex">
        {LINKS.map((l) => (
          <li key={l.label}>
            <a href={l.href} className={linkCls}>
              {l.label}
            </a>
          </li>
        ))}
        <li>
          <a href={`${SITE}/membership`} className={btnCls}>Join the Waitlist</a>
        </li>
        <li>
          <a href="https://www.caliberco.com/assets/pickleball-padel-in-arizona/" target="_blank" rel="noopener noreferrer" className={btnCls}>
            Invest
          </a>
        </li>
      </ul>

      {/* Mobile menu — no-JS <details> disclosure with the same items. */}
      <details className="relative lg:hidden">
        <summary className="grid h-10 w-10 cursor-pointer list-none place-items-center text-[#0a1628] [&::-webkit-details-marker]:hidden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span className="sr-only">Menu</span>
        </summary>
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-[#d8dde8] bg-white p-2 shadow-xl">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} className="block rounded px-3 py-2 text-sm font-semibold uppercase tracking-wide text-[#4a5878] hover:bg-slate-50 hover:text-[#0a1628]">
              {l.label}
            </a>
          ))}
          <a href={`${SITE}/membership`} className="mt-1 block rounded bg-[#8ab800] px-3 py-2 text-center text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#729a00]">
            Join the Waitlist
          </a>
          <a href="https://www.caliberco.com/assets/pickleball-padel-in-arizona/" target="_blank" rel="noopener noreferrer" className="mt-1 block rounded bg-[#8ab800] px-3 py-2 text-center text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#729a00]">
            Invest
          </a>
        </div>
      </details>
    </div>
  );
}
