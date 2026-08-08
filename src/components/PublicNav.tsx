import Link from "next/link";
import { Logo } from "./Brand";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

export async function PublicNav() {
  const session = await getSession();
  const home = session ? (isStaff(session.role) ? "/console" : "/portal") : null;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          <Link href="/programs" className="hover:text-brand-700">Programs</Link>
          <Link href="/locations" className="hover:text-brand-700">Locations</Link>
          <Link href="/standings" className="hover:text-brand-700">League Standings</Link>
          <Link href="/schedule" className="hover:text-brand-700">Schedule</Link>
        </nav>
        <div className="flex items-center gap-2">
          {home ? (
            <Link href={home} className="btn-primary">My Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Log in</Link>
              <Link href="/register" className="btn-primary">Register</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
