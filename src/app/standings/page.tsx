import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { leagueStandingsFlat } from "@/lib/domain/leagueStandings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "League Standings — Arizona Club Pickleball" },
  description: "Live standings by division for Arizona Club Pickleball, a DUPR-recorded league.",
  alternates: { canonical: "/standings" },
};

export default async function StandingsPage() {
  // The public leaderboard is the active ACP league's flat roster — the same
  // ladder the console shows. Line 4 is an exhibition and counts toward nothing.
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  const standings = season ? await leagueStandingsFlat(season.id) : [];

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">League standings</h1>
        <p className="mt-2 text-slate-600">
          {season ? `${season.name} — ` : ""}Arizona Club Pickleball. The top three lines decide each
          match; forfeits are recorded 3–0 and never submitted to DUPR.
        </p>

        <div className="mt-8">
          {standings.length === 0 ? (
            <p className="text-slate-500">Standings will appear once league play begins.</p>
          ) : (
            <section className="card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1 pr-2">#</th>
                      <th>Team</th>
                      <th className="text-center">P</th>
                      <th className="text-center">W</th>
                      <th className="text-center">L</th>
                      <th className="text-center">Lines</th>
                      <th className="text-center" title="Point differential across counting lines">Diff</th>
                      <th className="text-center">FF</th>
                      <th className="text-center">Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {standings.map((s, i) => {
                      const diff = s.pointsFor - s.pointsAgainst;
                      return (
                        <tr key={s.teamId} className={i < 2 ? "bg-accent-50/40" : ""}>
                          <td className="py-1.5 pr-2 font-semibold text-slate-500">{i + 1}</td>
                          <td className="font-medium text-slate-800">{s.teamName}</td>
                          <td className="text-center tabular-nums">{s.played}</td>
                          <td className="text-center tabular-nums">{s.matchesWon}</td>
                          <td className="text-center tabular-nums">{s.matchesLost}</td>
                          <td className="text-center tabular-nums text-slate-500">{s.linesWon}–{s.linesLost}</td>
                          <td className={`text-center tabular-nums ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-500"}`}>{diff > 0 ? `+${diff}` : diff}</td>
                          <td className={`text-center tabular-nums ${s.forfeits > 0 ? "text-rose-600 font-medium" : ""}`}>{s.forfeits}</td>
                          <td className="text-center font-bold text-slate-900 tabular-nums">{s.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
