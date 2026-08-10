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
  { href: "/console/board", label: "Board", icon: "🔀", roles: ["COO", "DIRECTOR"] },
  { href: "/console/teams", label: "Team Build", icon: "🧩", roles: ["COO", "DIRECTOR", "COACH"] },
  { href: "/console/coaches", label: "Coaches", icon: "🎯", roles: ["COO", "DIRECTOR"] },
  { href: "/console/users", label: "Access", icon: "🔑", roles: ["COO", "DIRECTOR"] },
  { href: "/console/profile", label: "My Profile", icon: "👤", roles: ["COACH"] },
  { href: "/console/facilities", label: "Facilities", icon: "🏟️", roles: ["COO", "CEO", "DIRECTOR"] },
  { href: "/console/schedule", label: "Schedule", icon: "📅", roles: ["COO", "DIRECTOR", "COACH"] },
  { href: "/console/league", label: "League", icon: "🏆", roles: ["COO", "DIRECTOR", "COACH"] },
  { href: "/console/championship", label: "Championship", icon: "🥇", roles: ["COO", "DIRECTOR"] },
  { href: "/console/alacarte", label: "À la carte", icon: "🎾", roles: ["COO", "DIRECTOR"] },
  { href: "/console/payments", label: "Payments", icon: "💳", roles: ["COO", "CEO", "DIRECTOR"] },
  { href: "/console/messages", label: "Messages", icon: "💬" },
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
  const items = NAV.filter((n) => !n.roles || n.roles.includes(role));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar (mobile-first) */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((v) => !v)} className="btn-ghost" aria-label="Menu">
            ☰
          </button>
          <Logo href="/console" className="h-7" />
        </div>
        <div className="flex items-center gap-3">
          <PadelLogo className="h-7" />
          <Link href="/logout" prefetch={false} className="text-sm text-slate-500">Sign out</Link>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl">
        {/* Sidebar */}
        <aside
          className={`${open ? "block" : "hidden"} w-full shrink-0 border-r border-slate-200 bg-white md:block md:w-64`}
        >
          <div className="hidden items-center gap-2 px-5 py-4 md:flex">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              PA
            </span>
            <div className="leading-tight">
              <div className="text-sm font-bold text-slate-900">PURE Console</div>
              <div className="text-[11px] text-slate-400">{ROLE_LABELS[role]}</div>
            </div>
          </div>
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
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                    active
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100"
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
          <div className="hidden items-center justify-between border-b border-slate-200 bg-white px-6 py-3 md:flex">
            <div className="flex items-center gap-3">
              <Logo href="/console" className="h-8" />
              <span className="text-sm text-slate-500">
                Signed in as <span className="font-semibold text-slate-800">{name}</span>
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/logout" prefetch={false} className="btn-ghost text-sm">Sign out</Link>
              <PadelLogo className="h-8" />
            </div>
          </div>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
