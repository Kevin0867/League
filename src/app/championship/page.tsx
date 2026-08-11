import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { Bracket, type BracketMatch } from "@/components/Bracket";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "ACP Championship — Arizona Club Pickleball" },
  description: "Championship week, December 7–13, 2026. Division events Monday to Friday.",
  alternates: { canonical: "/championship" },
};

export default async function PublicChampionshipPage() {
  const matches = await prisma.championshipMatch.findMany({ orderBy: [{ divisionId: "asc" }, { round: "asc" }, { slot: "asc" }] });
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamNames: Record<string, string> = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  const divisionIds = [...new Set(matches.map((m) => m.divisionId))];
  const divisions = divisionIds.length
    ? await prisma.division.findMany({ where: { id: { in: divisionIds } } })
    : [];
  const divName: Record<string, string> = Object.fromEntries(divisions.map((d) => [d.id, d.name]));

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Championship bracket</h1>
        <p className="mt-2 text-slate-600">Championship week, December 7–13. Single-elimination, seeded by division standings.</p>

        <div className="mt-8 space-y-10">
          {divisionIds.length === 0 && (
            <p className="text-slate-500">The championship bracket will appear here once it&apos;s drawn.</p>
          )}
          {divisionIds.map((did) => (
            <section key={did}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{divName[did] ?? "Division"}</h2>
              <Bracket matches={matches.filter((m) => m.divisionId === did) as unknown as BracketMatch[]} teamNames={teamNames} />
            </section>
          ))}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
