import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const seasons = await prisma.season.findMany({
    where: { active: true },
    include: { divisions: { orderBy: { name: "asc" } } },
    orderBy: { startDate: "desc" },
  });

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Programs &amp; divisions</h1>
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
                {s.startDate.toLocaleDateString()} – {s.endDate.toLocaleDateString()}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.divisions.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="font-medium text-slate-800">{d.name}</div>
                    <div className="text-xs text-slate-500">
                      {d.divisionType === "DUPR_BAND"
                        ? `DUPR ${d.minRating ?? "?"}–${d.maxRating ?? "?"}`
                        : "By school level"}
                    </div>
                  </div>
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
    </div>
  );
}
