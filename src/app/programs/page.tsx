import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { formatDateRange } from "@/lib/time";

export const dynamic = "force-dynamic";

// Public-safe grade bands for school-level divisions so parents can self-serve.
function schoolBand(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("elementary")) return "Elementary · grades K–5";
  if (n.includes("middle")) return "Middle school · grades 6–8";
  if (n.includes("high school")) return "High school · grades 9–12";
  return "By school level";
}

export default async function ProgramsPage() {
  const seasons = await prisma.season.findMany({
    where: { active: true },
    // Lessons are not competitive divisions — never list them here. Ordered so
    // school levels read youngest→oldest, then DUPR bands.
    include: { divisions: { where: { divisionType: { not: "LESSON" } }, orderBy: { name: "asc" } } },
    orderBy: { startDate: "desc" },
  });

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Programs &amp; divisions</h1>
        <p className="mt-2 text-slate-600">
          A twelve-session season per team: six practice weeks, five league weeks, and
          championship week. Youth divisions run by school level; adult divisions by DUPR band.
        </p>

        <div className="mt-8 space-y-8">
          {seasons.map((s) => (
            <section key={s.id} className="card">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">{s.name}</h2>
                <span className="badge bg-brand-100 text-brand-800">{s.program.replace("_", " ")}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {formatDateRange(s.startDate, s.endDate)}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.divisions.map((d) => (
                  <Link
                    key={d.id}
                    href={`/register?division=${encodeURIComponent(d.name)}`}
                    className="group flex flex-col rounded-lg border border-slate-200 p-3 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
                  >
                    <div className="font-medium text-slate-800 group-hover:text-brand-800">{d.name}</div>
                    <div className="text-xs text-slate-500">
                      {d.divisionType === "DUPR_BAND"
                        ? `DUPR ${d.minRating ?? "?"}–${d.maxRating ?? "?"}`
                        : schoolBand(d.name)}
                    </div>
                    <span className="mt-2 text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                      Sign up for this group →
                    </span>
                  </Link>
                ))}
                {s.divisions.length === 0 && <p className="text-sm text-slate-400">Divisions to be announced.</p>}
              </div>
            </section>
          ))}
          {seasons.length === 0 && <p className="text-slate-500">No active seasons published yet.</p>}
        </div>

        <div className="mt-10">
          <Link href="/register" className="btn-primary">Register for the season</Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
