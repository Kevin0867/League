import Link from "next/link";
import { Logo, PadelLogo } from "./Brand";
import { SiteHeader } from "./SiteHeader";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

const LINKS = [
  { href: "/programs", label: "Programs" },
  { href: "/coaches", label: "Coaches" },
  { href: "/teams", label: "Teams" },
  { href: "/clinics", label: "Clinics" },
  { href: "/locations", label: "Locations" },
  { href: "/standings", label: "Standings" },
  { href: "/championship", label: "Championship" },
  { href: "/schedule", label: "Schedule" },
];

export async function PublicNav() {
  const session = await getSession();
  const home = session ? (isStaff(session.role) ? "/console" : "/portal") : null;

  return (
    <div className="sticky top-0 z-30">
      {/* Parent-site bar (purepickleball.com) sits above the academy nav so the
          two pin together and the app reads as one site. */}
      <SiteHeader />
      <header className="border-b border-brand-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        {/* Logo → academy homepage when signed out, or the user's dashboard when signed in. */}
        <Logo href={home ?? "/"} />

        {/* Desktop nav — centered, takes the slack so it never butts the logo. */}
        <nav className="hidden flex-1 items-center justify-center gap-x-5 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-500 xl:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap hover:text-brand-900">
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Auth actions — pushed to the right; never wrap. */}
        <div className="ml-auto flex items-center gap-3 xl:ml-0">
          {home ? (
            <Link href={home} className="btn-accent whitespace-nowrap text-xs uppercase tracking-wide">My Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost whitespace-nowrap text-xs uppercase tracking-wide">Log in</Link>
              <Link href="/register" className="btn-accent whitespace-nowrap text-xs uppercase tracking-wide">Register</Link>
            </>
          )}
          <PadelLogo className="hidden h-8 sm:block" />

          {/* Compact menu below xl — no-JS <details> disclosure. */}
          <details className="relative xl:hidden">
            <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-brand-100 text-brand-700 [&::-webkit-details-marker]:hidden">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <span className="sr-only">Menu</span>
            </summary>
            <div className="absolute right-0 mt-2 w-52 rounded-xl border border-brand-100 bg-white p-2 shadow-lg">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-900"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </details>
        </div>
      </div>
      </header>
    </div>
  );
}
