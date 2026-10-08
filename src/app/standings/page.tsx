import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { leagueStandingsByDivision } from "@/lib/domain/leagueStandings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "League Standings — Arizona Club Pickleball" },
  description: "Live standings by division for Arizona Club Pickleball, a DUPR-recorded league.",
  alternates: { canonical: "/standings" },
};

export default async function StandingsPage() {
  // The public leaderboard, split by bracket (gender + level) — teams are ranked
  // only against others in their bracket, the same way the console shows it. Line
  // 4 is an exhibition and counts toward nothing.
  const season = await prisma.season.findFirst({ where: { active: true, isTest: false, program: "ACP" } });
  const groups = season ? await leagueStandingsByDivision(season.id) : [];

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">League standings</h1>
        <p className="mt-2 text-slate-600">
          {season ? `${season.name} — ` : ""}Arizona Club Pickleball. The top three lines decide each
          match; forfeits are recorded 3–0 and never submitted to DUPR.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Run a club? <Link href="/acp" className="font-medium text-brand-700 hover:underline">Bring a team into ACP →</Link>
        </p>

        <div className="mt-8 space-y-6">
          {groups.length === 0 ? (
            <p className="text-slate-500">Standings will appear once league play begins.</p>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="card">
                <h2 className="mb-3 text-lg font-bold text-slate-900">{g.label} <span className="text-sm font-normal text-slate-400">· {g.rows.length} team{g.rows.length === 1 ? "" : "s"}</span></h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] table-fixed text-sm tabular-nums">
                    <colgroup>
                      <col className="w-9" />
                      <col />
                      <col className="w-10" />
                      <col className="w-10" />
                      <col className="w-10" />
                      <col className="w-16" />
                      <col className="w-14" />
                      <col className="w-10" />
                      <col className="w-12" />
                    </colgroup>
                    <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-1 pr-2 font-medium">#</th>
                        <th className="font-medium">Team</th>
                        <th className="py-1 text-center font-medium">P</th>
                        <th className="py-1 text-center font-medium">W</th>
                        <th className="py-1 text-center font-medium">L</th>
                        <th className="py-1 text-center font-medium">Lines</th>
                        <th className="py-1 text-center font-medium" title="Point differential across counting lines">Diff</th>
                        <th className="py-1 text-center font-medium">FF</th>
                        <th className="py-1 text-center font-medium">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.rows.map((s, i) => {
                        const diff = s.pointsFor - s.pointsAgainst;
                        return (
                          <tr key={s.teamId} className={i < 2 ? "bg-accent-50/40" : ""}>
                            <td className="py-1.5 pr-2 font-semibold text-slate-500">{i + 1}</td>
                            <td className="truncate pr-2 font-medium text-slate-800">
                              {s.teamSlug ? (
                                <Link href={`/teams/${s.teamSlug}`} className="hover:text-brand-700 hover:underline">{s.teamName}</Link>
                              ) : (
                                s.teamName
                              )}
                            </td>
                            <td className="py-1.5 text-center">{s.played}</td>
                            <td className="py-1.5 text-center">{s.matchesWon}</td>
                            <td className="py-1.5 text-center">{s.matchesLost}</td>
                            <td className="py-1.5 text-center text-slate-500">{s.linesWon}–{s.linesLost}</td>
                            <td className={`py-1.5 text-center ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-500"}`}>{diff > 0 ? `+${diff}` : diff}</td>
                            <td className={`py-1.5 text-center ${s.forfeits > 0 ? "text-rose-600 font-medium" : ""}`}>{s.forfeits}</td>
                            <td className="py-1.5 text-center font-bold text-slate-900">{s.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
