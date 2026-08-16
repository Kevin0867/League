import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { StatusBadge } from "@/components/StatusBadge";
import { leagueWeekLabel } from "@/lib/domain/seasonCalendar";
import { matchTypeConfig, lineLabel, isCountingLine } from "@/lib/domain/matchType";
import { scoringFormatOf, maxGames, describeScoring } from "@/lib/domain/scoringFormat";

// The coach's own view of the League hub: only their teams' matches, with score
// entry (submitted as a proposal for the other team to accept), and accept /
// dispute controls when the opponent has entered scores first. All actions post
// to /api/console/league, which forces the acting team server-side and only
// allows a coach to touch their own matches.
export async function CoachLeagueMatches({ personId, ticket }: { personId: string; ticket: string }) {
  const coach = await prisma.coach.findUnique({ where: { personId }, select: { id: true } });
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" }, select: { id: true, name: true } });

  if (!coach || !season) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold text-slate-900">My matches</h1>
        <p className="mt-2 text-sm text-slate-500">No active league right now. When your team has scheduled matches, they&apos;ll appear here to enter and confirm scores.</p>
      </div>
    );
  }

  const myTeams = await prisma.team.findMany({
    where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
    select: { id: true, name: true },
  });
  const myTeamIds = new Set(myTeams.map((t) => t.id));

  const fixtures = await prisma.fixture.findMany({
    where: {
      seasonId: season.id,
      OR: [{ homeTeamId: { in: [...myTeamIds] } }, { awayTeamId: { in: [...myTeamIds] } }],
    },
    include: {
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
      facility: { select: { name: true } },
      lines: { include: { games: true }, orderBy: { lineNumber: "asc" } },
    },
    orderBy: [{ scheduledAt: "asc" }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My matches</h1>
        <p className="text-slate-500">{season.name} — enter your scores, and accept or dispute what the other team enters.</p>
      </div>

      {fixtures.length === 0 ? (
        <div className="card">
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No matches scheduled for your team yet. Your league matches will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {fixtures.map((f) => {
            const myTeamId = [f.homeTeamId, f.awayTeamId].find((id) => id && myTeamIds.has(id)) ?? null;
            const iAmHome = myTeamId === f.homeTeamId;
            const homeName = f.homeTeam?.name ?? "Home";
            const awayName = f.awayTeam?.name ?? "Away";
            const oppName = iAmHome ? awayName : homeName;
            const cfg = matchTypeConfig(f.matchType);
            const fmt = scoringFormatOf(f);
            const gameNums = Array.from({ length: maxGames(fmt) }, (_, i) => i + 1);
            const lineNums = Array.from({ length: cfg.lines }, (_, i) => i + 1);

            const proposedByMe = f.scoreStatus === "PROPOSED" && f.scoreProposedById === myTeamId;
            const proposedByOpp = f.scoreStatus === "PROPOSED" && f.scoreProposedById && f.scoreProposedById !== myTeamId;
            const finalized = f.status === "COMPLETED" || f.scoreStatus === "ACCEPTED";
            const forfeited = f.status === "FORFEITED";

            return (
              <div key={f.id} className="card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-slate-900">
                      {homeName} <span className="text-slate-400">vs</span> {awayName}
                    </h2>
                    <p className="text-sm text-slate-500">
                      Wk {leagueWeekLabel(f.weekNumber)} · {formatDate(f.scheduledAt)} · {f.facility?.name ?? "hub TBD"} · {f.courtAllocation ?? "courts TBD"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{cfg.label} · {describeScoring(fmt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={f.status} />
                    {proposedByMe && <span className="badge bg-amber-100 text-amber-800">awaiting {oppName}</span>}
                    {proposedByOpp && <span className="badge bg-amber-100 text-amber-800">needs your OK</span>}
                    {finalized && <span className="badge bg-emerald-100 text-emerald-800">final</span>}
                  </div>
                </div>

                {forfeited ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">This match was recorded as a forfeit. Contact the office with any questions.</p>
                ) : finalized ? (
                  <ScoreReadout fixtureLines={f.lines} lineNums={lineNums} cfg={cfg} homeName={homeName} awayName={awayName} />
                ) : proposedByMe ? (
                  <div className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">
                    You submitted these scores — waiting for <span className="font-medium">{oppName}</span> to accept.
                    <ScoreReadout fixtureLines={f.lines} lineNums={lineNums} cfg={cfg} homeName={homeName} awayName={awayName} className="mt-2" />
                  </div>
                ) : proposedByOpp ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600"><span className="font-medium">{oppName}</span> entered these scores. Accept them to make the result final, or dispute if they&apos;re wrong.</p>
                    <ScoreReadout fixtureLines={f.lines} lineNums={lineNums} cfg={cfg} homeName={homeName} awayName={awayName} />
                    <div className="flex flex-wrap gap-2">
                      <form method="POST" action="/api/console/league">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="acceptScores" />
                        <input type="hidden" name="fixtureId" value={f.id} />
                        <input type="hidden" name="returnTo" value="/console/league" />
                        <button className="btn-primary text-sm">Accept scores</button>
                      </form>
                      <details className="relative">
                        <summary className="btn-secondary cursor-pointer text-sm text-rose-700 ring-rose-200 hover:bg-rose-50">Dispute</summary>
                        <form method="POST" action="/api/console/league" className="absolute left-0 z-10 mt-2 w-72 space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                          <input type="hidden" name="ticket" value={ticket} />
                          <input type="hidden" name="op" value="disputeScores" />
                          <input type="hidden" name="fixtureId" value={f.id} />
                          <input type="hidden" name="returnTo" value="/console/league" />
                          <label className="label text-xs">What&apos;s wrong?</label>
                          <textarea name="scoreNote" rows={2} className="input text-sm" placeholder="e.g. Line 2 game 3 should be 11–9" />
                          <button className="btn-secondary w-full text-sm text-rose-700 ring-rose-200 hover:bg-rose-50">Submit dispute</button>
                        </form>
                      </details>
                    </div>
                  </div>
                ) : (
                  <CoachScoreForm
                    fixtureId={f.id}
                    ticket={ticket}
                    lineNums={lineNums}
                    gameNums={gameNums}
                    cfg={cfg}
                    homeName={homeName}
                    awayName={awayName}
                    existing={f.lines}
                    disputed={f.scoreStatus === "DISPUTED"}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type LineWithGames = { lineNumber: number; games: { gameNumber: number; homeScore: number; awayScore: number }[] };

// Read-only line scores (home left, away right).
function ScoreReadout({
  fixtureLines, lineNums, cfg, homeName, awayName, className = "",
}: {
  fixtureLines: LineWithGames[];
  lineNums: number[];
  cfg: ReturnType<typeof matchTypeConfig>;
  homeName: string;
  awayName: string;
  className?: string;
}) {
  const played = fixtureLines.length > 0;
  if (!played) return <p className={`text-sm text-slate-400 ${className}`}>No scores entered yet.</p>;
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="text-sm">
        <tbody className="divide-y divide-slate-100">
          {lineNums.map((line) => {
            const l = fixtureLines.find((x) => x.lineNumber === line);
            return (
              <tr key={line}>
                <td className="py-1 pr-3 text-slate-500">{lineLabel(line, cfg)}{!isCountingLine(line, cfg) && <span className="text-xs text-slate-400"> (exh)</span>}</td>
                <td className="py-1 tabular-nums text-slate-700">
                  {l && l.games.length > 0
                    ? l.games.sort((a, b) => a.gameNumber - b.gameNumber).map((g) => `${g.homeScore}–${g.awayScore}`).join(", ")
                    : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-slate-400">Left = {homeName} · Right = {awayName}</p>
    </div>
  );
}

// Coach score-entry sheet — home score first (left). Submits as a proposal; the
// server forces the acting team, so a coach can only report their own match.
function CoachScoreForm({
  fixtureId, ticket, lineNums, gameNums, cfg, homeName, awayName, existing, disputed,
}: {
  fixtureId: string;
  ticket: string;
  lineNums: number[];
  gameNums: number[];
  cfg: ReturnType<typeof matchTypeConfig>;
  homeName: string;
  awayName: string;
  existing: LineWithGames[];
  disputed: boolean;
}) {
  return (
    <form method="POST" action="/api/console/league" className="space-y-3">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="enterScores" />
      <input type="hidden" name="fixtureId" value={fixtureId} />
      <input type="hidden" name="returnTo" value="/console/league" />
      {disputed && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">These scores were disputed — re-enter the correct result and resubmit.</p>}
      <p className="text-sm text-slate-500">Enter each game — <span className="font-medium text-slate-700">{homeName}</span> (home) score on the left, <span className="font-medium text-slate-700">{awayName}</span> on the right. Leave a game blank if unplayed.</p>
      <div className="space-y-2">
        {lineNums.map((line) => {
          const l = existing.find((x) => x.lineNumber === line);
          return (
            <div key={line} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 text-sm font-medium text-slate-700">
                {lineLabel(line, cfg)}
                {!isCountingLine(line, cfg) && <span className="ml-1 text-xs text-slate-400">(non-counting)</span>}
              </div>
              <div className="flex flex-wrap gap-3">
                {gameNums.map((g) => {
                  const game = l?.games.find((x) => x.gameNumber === g);
                  return (
                    <div key={g} className="flex items-center gap-1">
                      <span className="w-8 text-xs text-slate-400">G{g}</span>
                      <input name={`l${line}_g${g}_h`} type="number" min={0} defaultValue={game?.homeScore ?? ""} className="input w-14 px-2 py-1 text-center" placeholder="H" aria-label={`${homeName} game ${g}`} />
                      <span className="text-slate-300">–</span>
                      <input name={`l${line}_g${g}_a`} type="number" min={0} defaultValue={game?.awayScore ?? ""} className="input w-14 px-2 py-1 text-center" placeholder="A" aria-label={`${awayName} game ${g}`} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn-primary text-sm">Submit our scores</button>
    </form>
  );
}
