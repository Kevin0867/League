"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo, PadelLogo } from "@/components/Brand";
import type { Role } from "@/lib/enums";
import { ROLE_LABELS } from "@/lib/enums";

type NavItem = { href: string; label: string; icon: string; roles?: Role[] };

const NAV: NavItem[] = [
  { href: "/console", label: "Dashboard", icon: "▚" },
  { href: "/console/setup", label: "Season Setup", icon: "⚙️", roles: ["COO", "DIRECTOR"] },
  { href: "/console/registrations", label: "Registrations", icon: "📝", roles: ["COO", "DIRECTOR"] },
  { href: "/console/import", label: "Import", icon: "⬆️", roles: ["COO", "DIRECTOR"] },
  { href: "/console/pools", label: "Assignment", icon: "🧮", roles: ["COO", "DIRECTOR"] },
  { href: "/console/board", label: "Boards", icon: "🔀", roles: ["COO", "DIRECTOR"] },
  { href: "/console/requests", label: "Requests", icon: "🙋", roles: ["COO", "DIRECTOR"] },
  { href: "/console/teams", label: "Team Build", icon: "🧩", roles: ["COO", "DIRECTOR", "COACH"] },
  { href: "/console/coaches", label: "Coaches", icon: "🎯", roles: ["COO", "DIRECTOR"] },
  { href: "/console/matching", label: "Coach matching", icon: "🧭", roles: ["COO", "DIRECTOR"] },
  { href: "/console/users", label: "Access", icon: "🔑", roles: ["COO", "DIRECTOR"] },
  { href: "/console/profile", label: "My Profile", icon: "👤", roles: ["COACH"] },
  { href: "/console/facilities", label: "Facilities", icon: "🏟️", roles: ["COO", "CEO", "DIRECTOR"] },
  { href: "/console/schedule", label: "Schedule", icon: "📅", roles: ["COO", "DIRECTOR", "COACH"] },
  { href: "/console/league", label: "League", icon: "🏆", roles: ["COO", "DIRECTOR", "COACH"] },
  { href: "/console/championship", label: "Championship", icon: "🥇", roles: ["COO", "DIRECTOR"] },
  { href: "/console/alacarte", label: "Private Lessons", icon: "🎾", roles: ["COO", "DIRECTOR"] },
  { href: "/console/payments", label: "Payments", icon: "💳", roles: ["COO", "CEO", "DIRECTOR"] },
  { href: "/console/messages", label: "Broadcasts", icon: "💬" },
  { href: "/console/compliance", label: "Compliance", icon: "✅", roles: ["COO", "DIRECTOR"] },
  { href: "/console/reports", label: "Reports", icon: "📊", roles: ["COO", "CEO", "DIRECTOR"] },
];

export function ConsoleShell({
  role,
  name,
  children,
}: {
  role: Role;
  name: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => {
    if (!n.roles) return true;
    if (n.roles.includes(role)) return true;
    // ADMIN inherits every admin-scoped item (any legacy admin role present).
    if (role === "ADMIN" && n.roles.some((r) => r === "COO" || r === "CEO" || r === "DIRECTOR")) return true;
    return false;
  });

  const chip = "inline-flex items-center rounded-lg bg-white px-2 py-1 shadow-sm";
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar (mobile-first) — navy chrome with a lime underline */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b-2 border-accent-500 bg-brand-900 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg px-2 py-1 text-white hover:bg-white/10" aria-label="Menu">
            ☰
          </button>
          <span className={chip}><Logo href="/console" className="h-6" /></span>
        </div>
        <div className="flex items-center gap-3">
          <span className={chip}><PadelLogo className="h-9" /></span>
          <Link href="/logout" prefetch={false} className="text-sm font-semibold text-white/80 hover:text-white">Sign out</Link>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl">
        {/* Sidebar — dark navy rail */}
        <aside
          className={`${open ? "block" : "hidden"} w-full shrink-0 bg-brand-900 md:block md:w-64`}
        >
          <Link href="/console" className="hidden items-center gap-3 px-5 py-4 md:flex" aria-label="PURE Academy Console">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pure-icon.png" alt="PURE" className="h-10 w-10" />
            <div className="leading-tight">
              <div className="text-sm font-extrabold uppercase tracking-wide text-white">Academy Console</div>
              <div className="text-[11px] text-brand-200">{ROLE_LABELS[role]}</div>
            </div>
          </Link>
          <nav className="space-y-1 px-3 pb-6 pt-2">
            {items.map((item) => {
              const active =
                item.href === "/console"
                  ? pathname === "/console"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-accent-500 text-brand-900 shadow-sm"
                      : "text-brand-200 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="w-5 text-center">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 hidden items-center justify-between border-b-2 border-accent-500 bg-brand-900 px-6 py-3 md:flex">
            <span className={chip}><Logo href="/console" className="h-8" /></span>
            <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 text-base font-extrabold uppercase tracking-wide text-white lg:block">
              Academy Console
            </div>
            <div className="flex items-center gap-4 whitespace-nowrap">
              <span className="hidden text-sm text-brand-200 xl:inline">
                Signed in as <span className="font-semibold text-white">{name}</span>
              </span>
              <Link href="/logout" prefetch={false} className="whitespace-nowrap text-sm font-semibold text-white/80 hover:text-white">Sign out</Link>
              <span className={chip}><PadelLogo className="h-11" /></span>
            </div>
          </div>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
