import type { RosterMember, RosterStatusKind } from "@/lib/domain/teamCalendar";

// Shows a practice's roster availability at a glance: who's checked in (green),
// who's out and needs a sub (red), and who hasn't responded yet (blue). Seen by
// the coach, teammates, and admins.

const DOT: Record<RosterStatusKind, string> = {
  in: "bg-emerald-500",
  out: "bg-rose-500",
  pending: "bg-blue-500",
};
const CHIP: Record<RosterStatusKind, string> = {
  in: "border-emerald-200 bg-emerald-50 text-emerald-800",
  out: "border-rose-200 bg-rose-50 text-rose-800",
  pending: "border-blue-200 bg-blue-50 text-blue-800",
};

export function RosterStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Not checked in yet</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Checked in</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Out — sub needed</span>
    </div>
  );
}

export function RosterStatus({ members }: { members: RosterMember[] }) {
  if (members.length === 0) {
    return <p className="text-xs text-slate-400">No players on the roster yet.</p>;
  }
  const counts = members.reduce(
    (a, m) => { a[m.status] += 1; return a; },
    { in: 0, out: 0, pending: 0 } as Record<RosterStatusKind, number>,
  );
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-500">
        <span className="text-emerald-700">{counts.in} in</span>
        {" · "}<span className="text-rose-700">{counts.out} out</span>
        {" · "}<span className="text-blue-700">{counts.pending} not checked in</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => (
          <span key={`${m.personId}-${m.isSub ? "sub" : "m"}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP[m.status]}`}>
            <span className={`h-2 w-2 rounded-full ${DOT[m.status]}`} />
            {m.name}
            {m.isSub && <span className="rounded bg-white/70 px-1 text-[10px] font-semibold uppercase tracking-wide">sub</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
