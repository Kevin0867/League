import { DateField } from "@/components/DateField";
import { TimeSelect } from "@/components/TimeSelect";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { Bracket, type BracketMatch } from "@/components/Bracket";
import { roundRobinStandings } from "@/lib/domain/bracketRoundRobin";
import { mintConsoleTicket } from "@/lib/auth";
import { formatDateTime12 } from "@/lib/time";
import { requireAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const ERR_MESSAGES: Record<string, string> = {
  auth: "Not authorized to manage the championship.",
  division: "Division not found.",
  eligible: "Need at least two eligible teams to draw a bracket.",
  match: "Match not found.",
  teams: "Both teams must be set before recording a result.",
  winner: "Winner must be one of the two teams.",
};

export default async function ChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  // Divisions across active seasons that have teams.
  const divisions = await prisma.division.findMany({
    // Lessons aren't competitive divisions — no championship bracket for them.
    where: { season: { active: true }, divisionType: { not: "LESSON" } },
    include: { season: true, teams: true },
    orderBy: { name: "asc" },
  });

  const allMatches = await prisma.championshipMatch.findMany();
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamNames: Record<string, string> = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  // Distinct active seasons that have championship divisions — each is one
  // tournament with a single start time (matches aren't separately scheduled).
  const seasonMap = new Map(divisions.map((d) => [d.seasonId, d.season]));
  const seasons = [...seasonMap.values()];
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const hhmm = (d: Date | null) => (d ? new Date(d).toISOString().slice(11, 16) : "09:00");

  return (
    <div className="space-y-6">
      <PageHeader title="Championship" subtitle="Championship week, Dec 7–13. Teams are seeded from division standings. Pick a format per division — single or double elimination, waterfall, or King of the Court round-robin; byes auto-advance in the elimination draws." />

      {sp.ok === "bracket" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Bracket drawn.</div>
      )}
      {sp.ok === "result" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Result recorded.</div>
      )}
      {sp.ok === "start" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Tournament start time saved.</div>
      )}
      {sp.err && ERR_MESSAGES[sp.err] && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{ERR_MESSAGES[sp.err]}</div>
      )}

      {/* Tournament start — one time for the whole bracketed event */}
      {seasons.map((s) => (
        <div key={s.id} className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Tournament start — {s.name}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {s.championshipStartsAt
                  ? `Starts ${formatDateTime12(s.championshipStartsAt)}`
                  : "No start time set — the whole bracket plays from this time."}
              </p>
            </div>
            <form method="POST" action="/api/console/championship" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="setStart" />
              <input type="hidden" name="seasonId" value={s.id} />
              <div>
                <label className="label text-xs">Date</label>
                <DateField name="date" className="input py-1.5" defaultValue={iso(s.championshipStartsAt)} />
              </div>
              <div>
                <label className="label text-xs">Time</label>
                <TimeSelect name="time" className="input py-1.5" defaultValue={hhmm(s.championshipStartsAt)} />
              </div>
              <button className="btn-secondary py-1.5 text-sm">Save</button>
            </form>
          </div>
        </div>
      ))}

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
                <form method="POST" action="/api/console/championship" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="generateBracket" />
                  <input type="hidden" name="divisionId" value={d.id} />
                  <div>
                    <label className="label text-xs">Format</label>
                    <select name="format" className="input py-1.5 text-sm" defaultValue="single">
                      <option value="single">Single elimination</option>
                      <option value="double">Double elimination</option>
                      <option value="waterfall">Waterfall (Gold + flights)</option>
                      <option value="kotc">King of the Court (round-robin)</option>
                    </select>
                  </div>
                  <button className="btn-secondary text-sm" disabled={eligible < 2}>
                    {matches.length > 0 ? "Redraw bracket" : "Draw bracket"}
                  </button>
                </form>
              </div>
              {matches.some((m) => m.bracket === "RR") && (() => {
                const table = roundRobinStandings(matches);
                const played = table.reduce((n, s) => n + s.played, 0) > 0;
                return (
                  <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">#</th>
                          <th className="px-3 py-2 font-semibold">Team</th>
                          <th className="px-3 py-2 text-center font-semibold">W</th>
                          <th className="px-3 py-2 text-center font-semibold">L</th>
                          <th className="px-3 py-2 text-center font-semibold">Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.map((s, i) => (
                          <tr key={s.teamId} className={`border-b border-slate-100 last:border-0 ${i === 0 && played ? "bg-amber-50" : ""}`}>
                            <td className="px-3 py-2 text-slate-400">
                              {i === 0 && played ? <span title="King of the Court">👑</span> : i + 1}
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800">{teamNames[s.teamId] ?? "Unknown"}</td>
                            <td className="px-3 py-2 text-center tabular-nums text-slate-700">{s.wins}</td>
                            <td className="px-3 py-2 text-center tabular-nums text-slate-700">{s.losses}</td>
                            <td className="px-3 py-2 text-center tabular-nums text-slate-500">{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
              {matches.length > 0 ? (
                <Bracket matches={matches} teamNames={teamNames} editable ticket={ticket} />
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
