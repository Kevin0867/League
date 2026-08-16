import Link from "next/link";
import { formatDate } from "@/lib/time";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { mintConsoleTicket } from "@/lib/auth";
import { leagueWeekLabel } from "@/lib/domain/seasonCalendar";
import { matchTypeConfig, lineLabel, isCountingLine } from "@/lib/domain/matchType";
import { scoringFormatOf, maxGames, describeScoring } from "@/lib/domain/scoringFormat";
import { ScoringFormatFields } from "@/components/ScoringFormatFields";
import { LINE_CATEGORIES, LINE_TEMPLATES, lineTitle, isDreamBreaker, doublesAreTied } from "@/lib/domain/lineCategory";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  submitLineup: "Line-up submitted.",
  enterScores: "Scores saved — match completed.",
  proposeScores: "Scores submitted — the other team was asked to accept.",
  acceptScores: "Scores accepted — the result is final.",
  disputeScores: "Scores disputed — an admin can enter the official result.",
  setScoringFormat: "Scoring format updated.",
  applyLineTemplate: "Lines added from the template.",
  addLine: "Line added.",
  removeLine: "Line removed.",
  setLinePairs: "Line pairs saved.",
  recordForfeit: "Forfeit recorded.",
  submitToDupr: "DUPR submission processed.",
};

const ERRORS: Record<string, string> = {
  auth: "Not authorized.",
  notfound: "Fixture or team not found.",
  nofixture: "Fixture not found.",
  noproposal: "There are no pending scores to accept or dispute.",
  notemplate: "Pick a template.",
  dupline: "That category and rank already has a line.",
  noline: "Line not found.",
  selfpair: "A player can't be paired with themselves.",
  minlines: "Submit at least three lines.",
  dupplayer: "A player appears on more than one line.",
  lineup: "Line-up rejected.",
  noteam: "Select a forfeiting team.",
  forfeited: "Forfeited fixtures are never submitted to DUPR.",
  op: "Unknown operation.",
};

type RosterMember = { personId: string; person: { firstName: string; lastName: string; duprRating: number | null } };

export default async function FixtureDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const fixture = await prisma.fixture.findUnique({
    where: { id },
    include: {
      homeTeam: { include: { members: { include: { person: true } } } },
      awayTeam: { include: { members: { include: { person: true } } } },
      facility: true,
      lines: { include: { games: true }, orderBy: { lineNumber: "asc" } },
      duprSubmission: true,
    },
  });
  if (!fixture) notFound();

  const pairings = await prisma.pairing.findMany({
    where: {
      teamId: { in: [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as string[] },
      weekNumber: fixture.weekNumber,
    },
    include: { playerA: true, playerB: true },
    orderBy: { rank: "asc" },
  });

  const teams = [fixture.homeTeam, fixture.awayTeam].filter(Boolean) as NonNullable<typeof fixture.homeTeam>[];
  const dupr = fixture.duprSubmission;
  const played = fixture.status === "COMPLETED";
  const forfeited = fixture.status === "FORFEITED";
  const cfg = matchTypeConfig(fixture.matchType);
  const lineNums = Array.from({ length: cfg.lines }, (_, i) => i + 1);
  const fmt = scoringFormatOf(fixture);
  const gameNums = Array.from({ length: maxGames(fmt) }, (_, i) => i + 1);

  const homeId = fixture.homeTeamId;
  const awayId = fixture.awayTeamId;
  const homeName = fixture.homeTeam?.name ?? "Home";
  const awayName = fixture.awayTeam?.name ?? "Away";

  // Score-acceptance state.
  const proposedByName =
    fixture.scoreProposedById === homeId ? homeName : fixture.scoreProposedById === awayId ? awayName : null;
  const proposed = fixture.scoreStatus === "PROPOSED";
  const disputed = fixture.scoreStatus === "DISPUTED";
  const accepted = fixture.scoreStatus === "ACCEPTED";
  // The pair (by first names) a team fielded on a given line, from its line-up.
  const pairFor = (teamId: string | null, line: number) => {
    if (!teamId) return null;
    const p = pairings.find((x) => x.teamId === teamId && x.rank === line);
    return p ? `${p.playerA.firstName} & ${p.playerB.firstName}` : null;
  };

  // Roster name lookup for the categorized-line pairs (stored by id).
  const rosterName = new Map<string, string>();
  for (const t of teams) for (const m of t.members) rosterName.set(m.personId, `${m.person.firstName} ${m.person.lastName}`);
  const nameOf = (pid: string | null | undefined) => (pid ? rosterName.get(pid) ?? null : null);
  const homeRoster = (fixture.homeTeam?.members ?? []).map((m) => ({ id: m.personId, label: `${m.person.firstName} ${m.person.lastName}` }));
  const awayRoster = (fixture.awayTeam?.members ?? []).map((m) => ({ id: m.personId, label: `${m.person.firstName} ${m.person.lastName}` }));

  // The lines the score sheet renders: the categorized lines once set up, else
  // generic lines from the match type (legacy path).
  const hasLines = fixture.lines.length > 0;
  const dbTied = doublesAreTied(fixture.lines);
  const scoreLines = hasLines
    ? fixture.lines.map((l) => ({
        lineNumber: l.lineNumber,
        title: lineTitle(l),
        category: l.category,
        isCounting: l.isCounting,
        games: l.games,
        homePair: [nameOf(l.homePlayer1Id), nameOf(l.homePlayer2Id)].filter(Boolean).join(" & ") || null,
        awayPair: [nameOf(l.awayPlayer1Id), nameOf(l.awayPlayer2Id)].filter(Boolean).join(" & ") || null,
      }))
    : lineNums.map((n) => ({
        lineNumber: n,
        title: lineLabel(n, cfg),
        category: "OPEN",
        isCounting: isCountingLine(n, cfg),
        games: [] as typeof fixture.lines[number]["games"],
        homePair: pairFor(homeId, n),
        awayPair: pairFor(awayId, n),
      }));

  return (
    <div className="space-y-6">
      {sp.ok && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok] ?? "Done."}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {sp.err === "lineup" && sp.msg ? sp.msg : ERRORS[sp.err] ?? "Something went wrong."}
        </p>
      )}
      <div>
        <Link href="/console/league" className="text-sm text-brand-600 hover:underline">← League</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">
            {fixture.homeTeam?.name} <span className="text-slate-400">vs</span> {fixture.awayTeam?.name}
          </h1>
          <StatusBadge status={fixture.status} />
        </div>
        <p className="text-sm text-slate-500">
          Week {leagueWeekLabel(fixture.weekNumber)} · {formatDate(fixture.scheduledAt)} · {fixture.facility?.name ?? "hub TBD"} · {fixture.courtAllocation ?? "courts TBD"}
          <span className="ml-2 badge bg-slate-100 text-slate-600">{cfg.label}</span>
          <span className="ml-2 badge bg-slate-100 text-slate-600">{describeScoring(fmt)}</span>
        </p>
      </div>

      {/* Scoring format — round-robin vs playoff rules live here */}
      <details className="card">
        <summary className="flex cursor-pointer items-center justify-between gap-3">
          <span className="font-semibold text-slate-900">Scoring format</span>
          <span className="text-sm text-slate-500">{describeScoring(fmt)}</span>
        </summary>
        <form method="POST" action="/api/console/league" className="mt-3 space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="setScoringFormat" />
          <input type="hidden" name="fixtureId" value={fixture.id} />
          <ScoringFormatFields value={fmt} />
          <button className="btn-primary text-sm">Save format</button>
          <p className="text-xs text-slate-400">Changing the length rebuilds the score sheet below (up to {maxGames(fmt)} game{maxGames(fmt) === 1 ? "" : "s"} per line). Re-enter scores after a change.</p>
        </form>
      </details>

      {/* Score-acceptance status — teams propose, the opponent accepts/disputes,
          an admin can always enter the official result below. */}
      {!forfeited && (proposed || disputed || accepted) && (
        <div className={`card border-l-4 ${proposed ? "border-amber-400 bg-amber-50/40" : disputed ? "border-rose-400 bg-rose-50/40" : "border-emerald-400 bg-emerald-50/40"}`}>
          {proposed && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-amber-900">Scores awaiting acceptance</h2>
                <p className="mt-0.5 text-sm text-slate-600">
                  {proposedByName ?? "A team"} submitted the scores below. The opposing team accepts to make the result final, or disputes it. An admin can enter the official result at any time.
                </p>
              </div>
              <div className="flex gap-2">
                <form method="POST" action="/api/console/league">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="acceptScores" />
                  <input type="hidden" name="fixtureId" value={fixture.id} />
                  <button className="btn-primary text-sm">Accept scores</button>
                </form>
                <details className="relative">
                  <summary className="btn-secondary cursor-pointer text-sm text-rose-700 ring-rose-200 hover:bg-rose-50">Dispute</summary>
                  <form method="POST" action="/api/console/league" className="absolute right-0 z-10 mt-2 w-72 space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="disputeScores" />
                    <input type="hidden" name="fixtureId" value={fixture.id} />
                    <label className="label text-xs">What&apos;s wrong?</label>
                    <textarea name="scoreNote" rows={2} className="input text-sm" placeholder="e.g. Line 2 game 3 should be 11–9" />
                    <button className="btn-secondary w-full text-sm text-rose-700 ring-rose-200 hover:bg-rose-50">Submit dispute</button>
                  </form>
                </details>
              </div>
            </div>
          )}
          {disputed && (
            <div>
              <h2 className="font-semibold text-rose-900">Scores disputed</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                The proposed scores were flagged{fixture.scoreNote ? <>: <span className="italic">“{fixture.scoreNote}”</span></> : ""}. Enter the official result below to resolve it.
              </p>
            </div>
          )}
          {accepted && (
            <div>
              <h2 className="font-semibold text-emerald-900">Result confirmed</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Both teams agreed the scores{fixture.scoreAcceptedAt ? ` on ${formatDate(fixture.scoreAcceptedAt)}` : ""}. It&apos;s final and on the leaderboard. Re-entering official scores below overrides it.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Line-ups — one form for both teams. Each team is saved independently, so
          submitting leaves the other team's line-up exactly as it was. */}
      <form method="POST" action="/api/console/league" className="space-y-4">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="submitLineups" />
        <input type="hidden" name="fixtureId" value={fixture.id} />
        <div className="grid gap-6 lg:grid-cols-2">
          {teams.map((team) => (
            <LineupFields
              key={team.id}
              teamId={team.id}
              teamName={team.name}
              origin={team.origin}
              roster={team.members}
              existing={pairings.filter((p) => p.teamId === team.id)}
              isHome={team.id === homeId}
              lineNums={lineNums}
              exhibitionLine={cfg.exhibitionLine}
            />
          ))}
        </div>
        <div className="flex justify-end">
          <button className="btn-primary">Save line-ups</button>
        </div>
      </form>

      {/* Match lines — the categorized lines (Men's #1, Women's #1, Youth …),
          two names per side. Set these up so the score sheet and standings read
          them; pairs carry forward from the club's last match. */}
      {!forfeited && (homeId || awayId) && (
        <MatchLinesSetup
          ticket={ticket}
          fixtureId={fixture.id}
          lines={fixture.lines.map((l) => ({
            id: l.id, lineNumber: l.lineNumber, category: l.category, rank: l.rank, label: l.label,
            homePlayer1Id: l.homePlayer1Id, homePlayer2Id: l.homePlayer2Id,
            awayPlayer1Id: l.awayPlayer1Id, awayPlayer2Id: l.awayPlayer2Id,
          }))}
          homeRoster={homeRoster}
          awayRoster={awayRoster}
          homeName={homeName}
          awayName={awayName}
        />
      )}

      {/* Score entry — each line shows who played, home pair first */}
      {!forfeited && (
        <form method="POST" action="/api/console/league" className="card">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="enterScores" />
          <input type="hidden" name="fixtureId" value={fixture.id} />
          <h2 className="mb-1 font-semibold text-slate-900">Line-by-line scores</h2>
          <p className="mb-3 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{homeName}</span> <span className="text-slate-400">(home)</span> vs{" "}
            <span className="font-medium text-slate-700">{awayName}</span>. Format: <span className="font-medium text-slate-700">{describeScoring(fmt)}</span> — the home team&apos;s
            score is entered first (left). {cfg.exhibitionLine ? `Lines 1–${cfg.exhibitionLine - 1} count; line ${cfg.exhibitionLine} is the exhibition line (recorded, non-counting).` : `All ${cfg.lines} line${cfg.lines === 1 ? "" : "s"} count.`} Leave a
            game blank if unplayed.
          </p>
          {(homeId || awayId) && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="label mb-0 text-xs" htmlFor="enteredBy">Entering as</label>
              <select id="enteredBy" name="enteredBy" defaultValue="OFFICIAL" className="input py-1 text-sm sm:w-auto">
                <option value="OFFICIAL">Official (admin) — final</option>
                {homeId && <option value={homeId}>{homeName} — propose for the other team to accept</option>}
                {awayId && <option value={awayId}>{awayName} — propose for the other team to accept</option>}
              </select>
            </div>
          )}
          <div className="space-y-3">
            {scoreLines.map((sl) => {
              const winnerLabel = fixture.lines.find((l) => l.lineNumber === sl.lineNumber)?.lineWinner === "HOME"
                ? (sl.homePair ?? homeName)
                : fixture.lines.find((l) => l.lineNumber === sl.lineNumber)?.lineWinner === "AWAY"
                ? (sl.awayPair ?? awayName)
                : null;
              return (
                <div key={sl.lineNumber} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium text-slate-700">{sl.title}</span>
                    <span className="text-slate-600">
                      {sl.homePair ?? homeName} <span className="text-slate-400">vs</span> {sl.awayPair ?? awayName}
                    </span>
                    {!sl.isCounting && <span className="text-xs text-slate-400">(non-counting)</span>}
                    {isDreamBreaker(sl.category) && (
                      dbTied
                        ? <span className="badge bg-amber-100 text-amber-800">tied 2–2 — play the Dream Breaker</span>
                        : <span className="text-xs text-slate-400">singles tiebreaker — only if the doubles finish tied</span>
                    )}
                    {winnerLabel && <span className="badge bg-emerald-100 text-emerald-800">{winnerLabel} won</span>}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {gameNums.map((g) => {
                      const game = sl.games.find((x) => x.gameNumber === g);
                      return (
                        <div key={g} className="flex items-center gap-1">
                          <span className="w-8 text-xs text-slate-400">G{g}</span>
                          <input name={`l${sl.lineNumber}_g${g}_h`} type="number" min={0} defaultValue={game?.homeScore ?? ""} className="input px-2 py-1 text-center" placeholder="H" aria-label={`${homeName} game ${g}`} />
                          <span className="text-slate-300">–</span>
                          <input name={`l${sl.lineNumber}_g${g}_a`} type="number" min={0} defaultValue={game?.awayScore ?? ""} className="input px-2 py-1 text-center" placeholder="A" aria-label={`${awayName} game ${g}`} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-400">Left = {homeName} · Right = {awayName}</span>
            <button className="btn-primary">{played ? "Update scores" : "Save scores"}</button>
          </div>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* DUPR submission queue */}
        <div className="card">
          <h2 className="mb-2 font-semibold text-slate-900">DUPR submission</h2>
          {forfeited ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Forfeited fixtures are excluded from DUPR by rule — never submitted.
            </p>
          ) : !played ? (
            <p className="text-sm text-slate-400">Enter and complete scores to queue a submission.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={dupr?.status ?? "PENDING"} />
                {dupr?.attempts ? <span className="text-xs text-slate-400">{dupr.attempts} attempt(s)</span> : null}
              </div>
              {dupr?.lastError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{dupr.lastError}</p>}
              {dupr?.status === "SUBMITTED" ? (
                <p className="text-sm text-emerald-700">Submitted{dupr.submittedAt ? ` on ${formatDate(dupr.submittedAt)}` : ""}. Every game reported, including line 4.</p>
              ) : (
                <form method="POST" action="/api/console/league">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="submitToDupr" />
                  <input type="hidden" name="fixtureId" value={fixture.id} />
                  <button className="btn-primary text-sm">
                    {dupr?.status === "REJECTED" ? "Retry submission" : "Submit to DUPR"}
                  </button>
                </form>
              )}
              <p className="text-xs text-slate-400">Identities are verified before submission — a result on the wrong account moves a stranger&apos;s rating.</p>
            </div>
          )}
        </div>

        {/* Forfeit */}
        {!forfeited && (
          <form method="POST" action="/api/console/league" className="card">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="recordForfeit" />
            <input type="hidden" name="fixtureId" value={fixture.id} />
            <h2 className="mb-2 font-semibold text-slate-900">Record forfeit</h2>
            <p className="mb-3 text-xs text-slate-500">
              3–0 in the standings, never submitted to DUPR. Two forfeits ends Championship eligibility.
            </p>
            <label className="label" htmlFor="forfeitingTeamId">Forfeiting team</label>
            <select id="forfeitingTeamId" name="forfeitingTeamId" className="input" required>
              <option value="">— select —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn-secondary mt-3 w-full text-rose-700 ring-rose-200 hover:bg-rose-50">Record forfeit</button>
          </form>
        )}
      </div>
    </div>
  );
}

function LineupFields({
  teamId, teamName, origin, roster, existing, isHome, lineNums, exhibitionLine,
}: {
  teamId: string;
  teamName: string;
  origin: string;
  roster: RosterMember[];
  existing: { rank: number; playerAId: string; playerBId: string; combinedDupr: number | null }[];
  isHome: boolean;
  lineNums: number[];
  exhibitionLine: number | null;
}) {
  const byRank = new Map(existing.map((p) => [p.rank, p]));
  const options = roster.map((m) => ({
    id: m.personId,
    label: `${m.person.firstName} ${m.person.lastName}${m.person.duprRating ? ` (${m.person.duprRating})` : ""}`,
  }));

  return (
    <div className="card">
      {/* Repeated per team — the handler reads getAll("teamId") and each team's
          own lu_<teamId>_* fields, so teams are saved independently. */}
      <input type="hidden" name="teamId" value={teamId} />
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">
          {teamName} line-up
          <span className="ml-2 badge bg-slate-100 text-slate-600">{isHome ? "Home" : "Away"}</span>
        </h2>
        <span className={`badge ${origin === "PURE_ACADEMY" ? "bg-brand-100 text-brand-800" : "bg-amber-100 text-amber-800"}`}>
          {origin === "PURE_ACADEMY" ? "by team rank" : "by combined DUPR"}
        </span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {origin === "PURE_ACADEMY"
          ? "Coach ranks by playing strength."
          : "Outside teams must rank line 1 ≥ line 2 ≥ line 3 by combined DUPR — enforced on submit."}
      </p>
      <div className="space-y-2">
        {lineNums.map((line) => {
          const ex = byRank.get(line);
          return (
            <div key={line} className="flex items-center gap-2">
              <span className="w-12 text-xs font-medium text-slate-500">
                {exhibitionLine === line ? "Exh." : `Line ${line}`}
              </span>
              <select name={`lu_${teamId}_${line}_a`} defaultValue={ex?.playerAId ?? ""} className="input py-1 text-sm">
                <option value="">—</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <select name={`lu_${teamId}_${line}_b`} defaultValue={ex?.playerBId ?? ""} className="input py-1 text-sm">
                <option value="">—</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SetupLine = {
  id: string;
  lineNumber: number;
  category: string;
  rank: number;
  label: string | null;
  homePlayer1Id: string | null;
  homePlayer2Id: string | null;
  awayPlayer1Id: string | null;
  awayPlayer2Id: string | null;
};
type RosterOpt = { id: string; label: string };

// The categorized-line editor: apply a template, add/remove lines, and set each
// line's two names per side. Pairs carry forward from the club's last match, so
// this is mostly confirming — swap a player by re-picking one dropdown.
function MatchLinesSetup({
  ticket, fixtureId, lines, homeRoster, awayRoster, homeName, awayName,
}: {
  ticket: string;
  fixtureId: string;
  lines: SetupLine[];
  homeRoster: RosterOpt[];
  awayRoster: RosterOpt[];
  homeName: string;
  awayName: string;
}) {
  const hidden = (
    <>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="fixtureId" value={fixtureId} />
    </>
  );
  const PairSelect = ({ name, value, roster }: { name: string; value: string | null; roster: RosterOpt[] }) => (
    <select name={name} defaultValue={value ?? ""} className="input py-1 text-sm">
      <option value="">—</option>
      {roster.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Match lines</h2>
          <p className="mt-0.5 text-sm text-slate-500">The categorized lines for this match — Men&apos;s #1, Women&apos;s #1, Youth Boys/Girls, etc. Two names per side; scores enter into these below.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {LINE_TEMPLATES.map((t) => (
            <form key={t.key} method="POST" action="/api/console/league">
              {hidden}
              <input type="hidden" name="op" value="applyLineTemplate" />
              <input type="hidden" name="templateKey" value={t.key} />
              <button className="btn-secondary text-xs" title={t.note}>{lines.length ? `+ ${t.label}` : t.label}</button>
            </form>
          ))}
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
          No lines yet. Apply a template above, or add lines one at a time below. (Without lines, the score sheet falls back to simple numbered lines.)
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">{lineTitle(l)}</span>
                <form method="POST" action="/api/console/league">
                  {hidden}
                  <input type="hidden" name="op" value="removeLine" />
                  <input type="hidden" name="lineId" value={l.id} />
                  <button className="text-xs text-rose-600 hover:underline">remove</button>
                </form>
              </div>
              <form method="POST" action="/api/console/league" className="grid gap-2 sm:grid-cols-2">
                {hidden}
                <input type="hidden" name="op" value="setLinePairs" />
                <input type="hidden" name="lineId" value={l.id} />
                <div>
                  <label className="label text-xs">{homeName} <span className="text-slate-400">(home)</span></label>
                  <div className="flex gap-2">
                    <PairSelect name="homePlayer1Id" value={l.homePlayer1Id} roster={homeRoster} />
                    <PairSelect name="homePlayer2Id" value={l.homePlayer2Id} roster={homeRoster} />
                  </div>
                </div>
                <div>
                  <label className="label text-xs">{awayName} <span className="text-slate-400">(away)</span></label>
                  <div className="flex gap-2">
                    <PairSelect name="awayPlayer1Id" value={l.awayPlayer1Id} roster={awayRoster} />
                    <PairSelect name="awayPlayer2Id" value={l.awayPlayer2Id} roster={awayRoster} />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <button className="btn-secondary text-xs">Save {lineTitle(l)} pairs</button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}

      {/* Add one line */}
      <form method="POST" action="/api/console/league" className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        {hidden}
        <input type="hidden" name="op" value="addLine" />
        <div>
          <label className="label text-xs">Category</label>
          <select name="category" className="input py-1 text-sm" defaultValue="MENS">
            {LINE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Rank #</label>
          <input name="rank" type="number" min={1} max={20} defaultValue={1} className="input w-20 py-1 text-sm" />
        </div>
        <div>
          <label className="label text-xs">Custom label <span className="text-slate-400">(optional)</span></label>
          <input name="label" className="input py-1 text-sm" placeholder="e.g. Mixed 1" />
        </div>
        <button className="btn-secondary text-sm">Add line</button>
      </form>
    </div>
  );
}
