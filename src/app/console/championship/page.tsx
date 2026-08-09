import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { Bracket, type BracketMatch } from "@/components/Bracket";
import { generateBracket } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChampionshipPage() {
  // Divisions across active seasons that have teams.
  const divisions = await prisma.division.findMany({
    where: { season: { active: true } },
    include: { season: true, teams: true },
    orderBy: { name: "asc" },
  });

  const allMatches = await prisma.championshipMatch.findMany();
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamNames: Record<string, string> = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Championship" subtitle="Championship week, Dec 7–13. Teams are seeded from division standings; the bracket is single-elimination and byes auto-advance." />

      {divisions.filter((d) => d.teams.length > 0).length === 0 && (
        <p className="text-slate-500">No divisions with teams yet.</p>
      )}

      {divisions
        .filter((d) => d.teams.length > 0)
        .map((d) => {
          const matches = allMatches.filter((m) => m.divisionId === d.id) as unknown as BracketMatch[];
          const eligible = d.teams.filter((t) => t.champEligible).length;
          return (
            <div key={d.id} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{d.name}</h2>
                  <p className="text-xs text-slate-400">
                    {d.season.name} · {eligible} eligible team{eligible === 1 ? "" : "s"}
                    {eligible < d.teams.length ? ` (${d.teams.length - eligible} ineligible)` : ""}
                  </p>
                </div>
                <form action={generateBracket}>
                  <input type="hidden" name="divisionId" value={d.id} />
                  <button className="btn-secondary text-sm" disabled={eligible < 2}>
                    {matches.length > 0 ? "Redraw bracket" : "Draw bracket"}
                  </button>
                </form>
              </div>
              {matches.length > 0 ? (
                <Bracket matches={matches} teamNames={teamNames} editable />
              ) : (
                <p className="text-sm text-slate-400">
                  {eligible < 2 ? "Need at least two eligible teams to draw." : "Not drawn yet."}
                </p>
              )}
            </div>
          );
        })}
    </div>
  );
}
