import Link from "next/link";
import { Logo, PadelLogo } from "./Brand";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

export async function PublicNav() {
  const session = await getSession();
  const home = session ? (isStaff(session.role) ? "/console" : "/portal") : null;
  return (
    <header className="sticky top-0 z-30 border-b border-brand-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Logo → academy homepage when signed out, or the user's dashboard when signed in. */}
        <Logo href={home ?? "/"} />
        <nav className="hidden items-center gap-7 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-500 lg:flex">
          <Link href="/programs" className="hover:text-brand-900">Programs</Link>
          <Link href="/locations" className="hover:text-brand-900">Locations</Link>
          <Link href="/standings" className="hover:text-brand-900">Standings</Link>
          <Link href="/championship" className="hover:text-brand-900">Championship</Link>
          <Link href="/schedule" className="hover:text-brand-900">Schedule</Link>
        </nav>
        <div className="flex items-center gap-3">
          {home ? (
            <Link href={home} className="btn-accent text-xs uppercase tracking-wide">My Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost text-xs uppercase tracking-wide">Log in</Link>
              <Link href="/register" className="btn-accent text-xs uppercase tracking-wide">Register</Link>
            </>
          )}
          <PadelLogo className="hidden h-8 sm:block" />
        </div>
      </div>
    </header>
  );
}
