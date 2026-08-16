import Link from "next/link";

// Pools / Board / Teams are three lenses on the same job — placing registered
// players onto teams — so they live under one "Rostering" sidebar entry and
// switch here instead of reading as three separate destinations.
const VIEWS = [
  { href: "/console/teams", label: "Teams", hint: "Build & complete teams" },
  { href: "/console/board", label: "Board", hint: "Drag players onto teams" },
  { href: "/console/pools", label: "Pools", hint: "Group the unplaced" },
] as const;

export function RosteringTabs({ active }: { active: "teams" | "board" | "pools" }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {VIEWS.map((v) => {
        const on = v.label.toLowerCase() === active;
        return (
          <Link
            key={v.href}
            href={v.href}
            title={v.hint}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              on ? "bg-white text-brand-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}
