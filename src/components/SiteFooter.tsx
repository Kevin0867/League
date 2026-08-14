// Mirror of the purepickleball.com footer section so the academy app matches the
// parent site top and bottom. Three stacked pieces on the main site — Partners
// bar, Newsletter, Footer. Newsletter + Footer are mirrored here; the Partners
// bar needs the two partner logo files hosted in /public/brand (hotlinking the
// parent site's /assets paths 404s, same as the nav logo did) — drop
// partner-honorhealth.png + partner-wolfgangpuck.png in and flip PARTNERS on.
//
// Links that were relative on the parent site are made absolute back to it, and
// the newsletter posts to the parent site's endpoint. Brand tokens: navy
// #0a1628, green #8ab800, dark-green accent #5f7d00.

const SITE = "https://purepickleball.com";

// Partner logos hosted in /public/brand. The bar renders when this is non-empty.
const PARTNERS: { name: string; href: string; logo: string }[] = [
  { name: "HonorHealth", href: "https://www.honorhealth.com/medical-services/sports-medicine", logo: "/brand/partner-honorhealth.png" },
  { name: "Wolfgang Puck Catering", href: "https://wolfgangpuckcatering.com/", logo: "/brand/partner-wolfgangpuck.png" },
];

// Academy-specific links kept above the mirrored PURE footer, so the compliance
// pages a paying / minor-enrolling program needs (season terms, opt-in, waiver)
// stay one click away even though the main footer points at the parent site.
const ACADEMY_LINKS = [
  { label: "Programs", href: "/programs" },
  { label: "Coaches", href: "/coaches" },
  { label: "Teams", href: "/teams" },
  { label: "Schedule", href: "/schedule" },
  { label: "Standings", href: "/standings" },
  { label: "Clinics", href: "/clinics" },
];
const ACADEMY_LEGAL = [
  { label: "Season Terms & Refunds", href: "/season-terms" },
  { label: "Email & Text Opt-in", href: "/opt-in" },
  { label: "Participation Waiver (PDF)", href: "/waiver.pdf" },
];

export function SiteFooter() {
  return (
    <div className="mt-16">
      {/* ===== Slim PURE Academy bar (light) — academy nav + compliance links ===== */}
      <section className="border-t border-slate-200 bg-slate-50 px-6 py-8 md:px-14">
        <div className="mx-auto flex max-w-[1300px] flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <div className="text-sm font-extrabold uppercase tracking-wide text-brand-900">PURE Academy</div>
            <p className="mt-1.5 text-sm text-slate-500">Team-based pickleball training across the Phoenix Valley.</p>
            <p className="mt-2 text-sm text-slate-600">
              <a href="mailto:team@purepickleball.com" className="hover:text-brand-700 hover:underline">team@purepickleball.com</a>
              <span className="mx-1.5 text-slate-300">·</span>
              <a href="tel:+12085695500" className="hover:text-brand-700 hover:underline">208.569.5500</a>
            </p>
          </div>
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Academy</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {ACADEMY_LINKS.map((l) => (
                  <li key={l.href}><a href={l.href} className="hover:text-brand-700 hover:underline">{l.label}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Season &amp; Legal</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {ACADEMY_LEGAL.map((l) => (
                  <li key={l.href}><a href={l.href} className="hover:text-brand-700 hover:underline">{l.label}</a></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Partners bar (white) — renders only when logos are hosted ===== */}
      {PARTNERS.length > 0 && (
        <section className="bg-white px-6 py-16 md:px-14">
          <div className="mx-auto max-w-[1300px] text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f7d00]">Our Partners</div>
            <h2 className="mb-10 mt-2 font-serif text-[#0a1628]" style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)" }}>
              Exclusive Partnerships &amp; <em className="text-[#5f7d00]">Sponsorships</em>
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-12 md:gap-20">
              {PARTNERS.map((p) => (
                <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer" className="transition-opacity hover:opacity-75">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.logo} alt={p.name} className="h-14 w-auto md:h-16" />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== Newsletter bar (dark navy) ===== */}
      <section className="px-6 py-12 md:px-14" style={{ background: "#0a1628" }}>
        <div className="mx-auto flex max-w-[1300px] flex-col items-start gap-10 md:flex-row">
          <div className="flex-shrink-0">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8ab800]">Stay in the Loop</div>
            <h3 className="mb-1 mt-2 font-serif text-2xl leading-tight text-white">
              Join Our<br /><em className="text-[#8ab800]">Newsletter</em>
            </h3>
          </div>
          <div className="flex-1">
            {/* Posts to the parent site's handler. Note: the parent's reCAPTCHA is
                domain-bound, so submissions from the academy may be rejected until
                a token/site-key is wired up here. */}
            <form method="post" action={`${SITE}/api/newsletter`} className="w-full">
              <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                <input name="firstName" placeholder="First Name *" required className="w-full rounded-none border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-[#8ab800] focus:outline-none" />
                <input name="lastName" placeholder="Last Name *" required className="w-full rounded-none border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-[#8ab800] focus:outline-none" />
              </div>
              <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                <input type="email" name="email" placeholder="Email Address *" required className="w-full rounded-none border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-[#8ab800] focus:outline-none" />
                <input type="tel" name="mobile" placeholder="Mobile *" required className="w-full rounded-none border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-[#8ab800] focus:outline-none" />
                <button type="submit" className="whitespace-nowrap bg-[#8ab800] px-6 py-2 text-[0.75rem] font-semibold uppercase tracking-widest text-white transition-colors hover:bg-[#729a00]">
                  Subscribe
                </button>
              </div>
              <label className="flex items-start gap-2 text-[0.65rem] text-white/50">
                <input type="checkbox" name="privacyConsent" required className="mt-0.5" />
                <span>
                  I agree to the{" "}
                  <a href={`${SITE}/privacy-policy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">Privacy Policy</a>{" "}&amp;{" "}
                  <a href={`${SITE}/terms-of-service`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">Terms of Use</a>{" "}
                  and to receive email and SMS communications from PURE Pickleball and Padel. *Required
                </span>
              </label>
            </form>
          </div>
        </div>
      </section>

      {/* ===== Footer (dark navy) ===== */}
      <footer className="px-6 pb-8 md:px-14" style={{ background: "#0a1628" }}>
        <div className="mx-auto max-w-[1300px]">
          <div className="pt-10">
            <div className="mb-3 text-[0.7rem] uppercase tracking-widest text-white/60">Socials</div>
            <div className="flex gap-3">
              <a href="https://www.facebook.com/profile.php?id=100091295534578" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                 className="flex h-9 w-9 items-center justify-center border border-white/20 text-white/60 transition-colors hover:border-[#8ab800] hover:text-[#8ab800]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                  <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.53-1.5H16.7V3.6c-.28-.04-1.25-.12-2.38-.12-2.36 0-3.97 1.44-3.97 4.08v2.27H7.65V13h2.7v8h3.15z" />
                </svg>
              </a>
              <a href="https://www.instagram.com/purepickleballandpadel" target="_blank" rel="noopener noreferrer" aria-label="Instagram"
                 className="flex h-9 w-9 items-center justify-center border border-white/20 text-white/60 transition-colors hover:border-[#8ab800] hover:text-[#8ab800]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-4 pt-7 md:flex-row">
            <p className="text-[0.75rem] text-white/35">© 2026 PURE Pickleball &amp; Padel™. All Rights Reserved.</p>
            <div className="flex flex-wrap justify-center gap-5">
              <a href={`${SITE}/privacy-policy`} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] text-white/35 hover:text-white/70">Privacy Policy</a>
              <a href={`${SITE}/terms-of-service`} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] text-white/35 hover:text-white/70">Terms of Service</a>
              <a href={SITE} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] text-white/35 hover:text-white/70">purepickleball.com</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
