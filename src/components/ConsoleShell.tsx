"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo, PadelLogo } from "@/components/Brand";
import { CommandPalette, CommandPaletteButton } from "@/components/CommandPalette";
import { AskBrett } from "@/components/AskBrett";
import type { Role } from "@/lib/enums";
import { ROLE_LABELS } from "@/lib/enums";

type NavItem = { href: string; label: string; roles?: Role[]; match?: string[] };
type NavSection = { title: string; items: NavItem[] };

const DASHBOARD: NavItem = { href: "/console", label: "Dashboard" };
// Coaches lead with "Today" — their day-of home (today's classes + check-in).
const TODAY: NavItem = { href: "/console/today", label: "Today", roles: ["COACH"] };

// Grouped into logical clusters so a first-time admin can find where a task
// lives instead of scanning one long flat list.
const SECTIONS: NavSection[] = [
  {
    title: "Season structure",
    items: [
      { href: "/console/setup", label: "Season Setup", roles: ["COO", "DIRECTOR"] },
      { href: "/console/calendar", label: "Season Calendar", roles: ["COO", "DIRECTOR", "COACH"] },
      { href: "/console/registrations", label: "Registrations", roles: ["COO", "DIRECTOR"] },
      { href: "/console/import", label: "Import", roles: ["COO", "DIRECTOR"] },
    ],
  },
  {
    title: "Players & teams",
    items: [
      // One destination that opens on the Teams list, with Board / Pools as
      // in-page views — instead of three near-identically-named "board" routes.
      // Labeled "Teams" because that's the word admins look for.
      { href: "/console/teams", label: "Teams", roles: ["COO", "DIRECTOR", "COACH"], match: ["/console/pools", "/console/board", "/console/teams"] },
      { href: "/console/team-import", label: "Team import", roles: ["COO", "DIRECTOR"] },
      { href: "/console/requests", label: "Placement requests", roles: ["COO", "DIRECTOR"] },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/console/coaches", label: "Coaches", roles: ["COO", "DIRECTOR"], match: ["/console/coaches", "/console/coach-import"] },
      { href: "/console/coach-import", label: "Import coaches", roles: ["COO", "DIRECTOR"] },
      { href: "/console/matching", label: "Coach matching", roles: ["COO", "DIRECTOR"] },
      { href: "/console/users", label: "Access", roles: ["COO", "DIRECTOR"] },
      { href: "/console/profile", label: "My Profile", roles: ["COACH"] },
    ],
  },
  {
    title: "Coaching",
    items: [
      { href: "/console/handbook", label: "Coaching Handbook", roles: ["COO", "DIRECTOR", "COACH"] },
      { href: "/console/incident-report", label: "Incident Report", roles: ["COO", "DIRECTOR", "COACH"] },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/console/facilities", label: "Facilities", roles: ["COO", "CEO", "DIRECTOR"] },
      { href: "/console/schedule", label: "Schedule", roles: ["COO", "DIRECTOR", "COACH"] },
      { href: "/console/league", label: "League", roles: ["COO", "DIRECTOR", "COACH"] },
      { href: "/console/championship", label: "Championship", roles: ["COO", "DIRECTOR"] },
      { href: "/console/ladder", label: "Ladder", roles: ["COO", "DIRECTOR"] },
      { href: "/console/acp", label: "ACP Entries", roles: ["COO", "DIRECTOR"] },
      { href: "/console/alacarte", label: "Private Lessons", roles: ["COO", "DIRECTOR"] },
    ],
  },
  {
    title: "Money & comms",
    items: [
      { href: "/console/payments", label: "Payments", roles: ["COO", "CEO", "DIRECTOR"] },
      { href: "/console/apparel", label: "Apparel", roles: ["COO", "DIRECTOR"] },
      { href: "/console/sponsorships", label: "Sponsorships", roles: ["COO", "DIRECTOR"], match: ["/console/sponsorships"] },
      { href: "/console/inbox", label: "Inbox", roles: ["COO", "DIRECTOR", "COACH"] },
      { href: "/console/announcements", label: "Announcements", roles: ["COO", "DIRECTOR", "COACH"] },
      { href: "/console/lounge", label: "Coaches' Lounge", roles: ["ADMIN", "COO", "CEO", "DIRECTOR", "COACH"] },
      { href: "/console/messages", label: "Messaging", roles: ["COO", "DIRECTOR"] },
      { href: "/console/compliance", label: "Compliance", roles: ["COO", "DIRECTOR"] },
      { href: "/console/consent", label: "Consent log", roles: ["COO", "DIRECTOR"] },
      { href: "/console/feedback", label: "Feedback", roles: ["COO", "DIRECTOR"] },
      { href: "/console/reports", label: "Reports", roles: ["COO", "CEO", "DIRECTOR"] },
      { href: "/console/system", label: "System", roles: ["COO", "DIRECTOR"] },
      { href: "/console/organizations", label: "Mission Control", roles: ["COO", "DIRECTOR"], match: ["/console/organizations"] },
    ],
  },
];

export function ConsoleShell({
  role,
  roles,
  name,
  children,
  ask,
  unread = 0,
  announcements = 0,
}: {
  /** Primary role — used only for the sidebar badge label. */
  role: Role;
  /** Every role the user holds — drives nav visibility so a multi-role user
   *  (e.g. a parent who also coaches) sees the items for ALL their roles. */
  roles?: Role[];
  name: string;
  children: React.ReactNode;
  /** When present (admin only), floats the "Ask Brett" assistant on every page. */
  ask?: { ticket: string; configured: boolean } | null;
  /** Unread direct-message threads — drives the top banner + Inbox nav badge. */
  unread?: number;
  /** Unread broadcast announcements — drives its own banner + nav badge. */
  announcements?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const held = roles && roles.length ? roles : [role];
  // A coach who holds no admin role lands on Today and has no admin dashboard —
  // so the "Dashboard" link is hidden for them (it would just bounce to Today).
  const coachOnly = held.includes("COACH") && !held.some((r) => r === "ADMIN" || r === "COO" || r === "CEO" || r === "DIRECTOR");
  const roleVisible = (n: NavItem) => {
    if (!n.roles) return true;
    // Visible if the user holds ANY role the item allows.
    if (n.roles.some((r) => held.includes(r))) return true;
    // ADMIN inherits every admin-scoped item (any legacy admin role present).
    if (held.includes("ADMIN") && n.roles.some((r) => r === "COO" || r === "CEO" || r === "DIRECTOR")) return true;
    return false;
  };
  const sections = SECTIONS.map((s) => ({ title: s.title, items: s.items.filter(roleVisible) })).filter(
    (s) => s.items.length > 0
  );

  const isActive = (href: string) => (href === "/console" ? pathname === "/console" : pathname.startsWith(href));
  // An item is active on its own href or any of its extra `match` paths (so the
  // single Rostering entry lights up on /pools, /board and /teams alike).
  const isActiveItem = (item: NavItem) => isActive(item.href) || (item.match?.some((p) => pathname.startsWith(p)) ?? false);
  // Name of the page currently open, for the top bar. Prefer the most specific
  // (longest-href) matching nav item so /console/today wins over /console.
  const pageTitle =
    [TODAY, DASHBOARD, ...SECTIONS.flatMap((s) => s.items)]
      .filter((it) => isActiveItem(it))
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "Console";
  // Every item renders as a squared button block. The active section is
  // illuminated with the lime fill; inactive items are quiet outlined buttons on
  // the navy rail. No icons — the label carries it.
  const linkClass = (active: boolean) =>
    `block w-full rounded-md px-3 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
      active
        ? "bg-accent-500 text-brand-900 ring-accent-400 shadow-lg shadow-accent-500/20"
        : "bg-white/[0.04] text-brand-100 ring-white/10 hover:bg-white/10 hover:text-white hover:ring-white/20"
    }`;

  const chip = "inline-flex items-center rounded-lg bg-white px-2 py-1 shadow-sm";
  return (
    <div className="min-h-screen bg-slate-50">
      <CommandPalette />
      {/* Top bar (mobile-first) — navy chrome with a lime underline */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b-2 border-accent-500 bg-brand-900 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg px-2 py-1 text-white hover:bg-white/10" aria-label="Menu">
            ☰
          </button>
          <span className={chip}><Logo href="/console" className="h-6" /></span>
        </div>
        <div className="flex items-center gap-3">
          <CommandPaletteButton />
          <span className={chip}><PadelLogo className="h-9" /></span>
          <Link href="/logout" prefetch={false} className="text-sm font-semibold text-white/80 hover:text-white">Sign out</Link>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl">
        {/* Sidebar — dark navy rail */}
        <aside
          className={`${open ? "block" : "hidden"} w-full shrink-0 bg-brand-900 md:sticky md:top-0 md:block md:h-screen md:w-64 md:self-start md:overflow-y-auto`}
        >
          <Link href="/console" className="hidden items-center gap-3 px-5 py-4 md:flex" aria-label="PURE Academy Console">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pure-icon.png" alt="PURE" className="h-10 w-10" />
            <div className="leading-tight">
              <div className="text-sm font-extrabold uppercase tracking-wide text-white">Academy Console</div>
              <div className="text-[11px] text-brand-200">{ROLE_LABELS[role]}</div>
            </div>
          </Link>
          <nav className="px-3 pb-6 pt-2">
            {roleVisible(TODAY) && (
              <Link href={TODAY.href} onClick={() => setOpen(false)} className={`${linkClass(isActiveItem(TODAY))} mb-1.5`}>
                {TODAY.label}
              </Link>
            )}
            {!coachOnly && (
              <Link href={DASHBOARD.href} onClick={() => setOpen(false)} className={linkClass(isActive(DASHBOARD.href))}>
                {DASHBOARD.label}
              </Link>
            )}
            {sections.map((section) => (
              <div key={section.title} className="mt-4">
                <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-300/70">
                  {section.title}
                </div>
                <div className="space-y-1.5">
                  {section.items.map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`${linkClass(isActiveItem(item))} flex items-center justify-between`}>
                      <span>{item.label}</span>
                      {((item.href === "/console/inbox" && unread > 0) || (item.href === "/console/announcements" && announcements > 0)) && (
                        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white">{item.href === "/console/inbox" ? unread : announcements}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 hidden items-center justify-between gap-4 border-b-2 border-accent-500 bg-brand-900 px-6 py-3 md:flex">
            {/* The current page name — the sidebar already carries the logo and
                "Academy Console", so the bar names where you are instead. */}
            <h2 className="min-w-0 truncate text-base font-extrabold uppercase tracking-wide text-white">{pageTitle}</h2>
            <div className="flex items-center gap-4 whitespace-nowrap">
              <CommandPaletteButton />
              <span className="hidden text-sm text-brand-200 xl:inline">
                Signed in as <span className="font-semibold text-white">{name}</span>
              </span>
              <Link href="/logout" prefetch={false} className="whitespace-nowrap text-sm font-semibold text-white/80 hover:text-white">Sign out</Link>
            </div>
          </div>
          <div className="p-4 md:p-6">
            {unread > 0 && (
              <Link
                href="/console/inbox"
                className="mb-4 flex items-center gap-3 rounded-lg border border-accent-400 bg-accent-50 px-4 py-3 text-sm font-medium text-brand-900 hover:bg-accent-100"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-900 text-xs font-bold text-white">{unread}</span>
                You have {unread} unread {unread === 1 ? "message" : "messages"} — open your inbox to read {unread === 1 ? "it" : "them"} →
              </Link>
            )}
            {announcements > 0 && (
              <Link
                href="/console/announcements"
                className="mb-4 flex items-center gap-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-900 hover:bg-brand-100"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">{announcements}</span>
                You have {announcements} unread {announcements === 1 ? "announcement" : "announcements"} — read {announcements === 1 ? "it" : "them"} →
              </Link>
            )}
            {children}
          </div>
        </main>
      </div>
      {ask && <AskBrett ticket={ask.ticket} configured={ask.configured} />}
    </div>
  );
}
