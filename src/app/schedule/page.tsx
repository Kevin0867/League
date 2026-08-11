import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Schedule — Arizona Club Pickleball" },
  description: "Fixtures, results, and remaining schedule by division and team.",
  alternates: { canonical: "/schedule" },
};

export default async function PublicSchedulePage() {
  const fixtures = await prisma.fixture.findMany({
    where: { status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] } },
    include: { homeTeam: { include: { division: true } }, awayTeam: true, facility: true },
    orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
  });

  const byWeek = new Map<number, typeof fixtures>();
  for (const f of fixtures) {
    if (!byWeek.has(f.weekNumber)) byWeek.set(f.weekNumber, []);
    byWeek.get(f.weekNumber)!.push(f);
  }

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Remaining schedule</h1>
        <p className="mt-2 text-slate-600">Upcoming league fixtures by week. Exact court allocation and arrival instructions are shared with rostered players behind login.</p>

        <div className="mt-8 space-y-8">
          {[...byWeek.entries()].map(([week, fs]) => (
            <section key={week}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Week {week}</h2>
              <div className="space-y-2">
                {fs.map((f) => (
                  <div key={f.id} className="card flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-800">
                        {f.homeTeam?.name ?? "TBD"} <span className="text-slate-400">vs</span> {f.awayTeam?.name ?? "TBD"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatDate(f.scheduledAt)} · {f.facility?.name ?? "hub TBD"}
                        {f.homeTeam?.division ? ` · ${f.homeTeam.division.name}` : ""}
                      </div>
                    </div>
                    <StatusBadge status={f.status} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {byWeek.size === 0 && <p className="text-slate-500">No fixtures scheduled yet.</p>}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
