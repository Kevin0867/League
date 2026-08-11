import Link from "next/link";
import { formatDate } from "@/lib/time";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { teamConfirmation, shouldEscalate, MIN_CONFIRMED_PLAYERS } from "@/lib/domain/availability";
import { EditableFixtureRow } from "@/components/EditableFixtureRow";
import { seasonStandingsByDivision } from "@/lib/domain/leagueStandings";
import { CreateLeagueForm } from "./CreateLeagueForm";

export const dynamic = "force-dynamic";

const PRACTICE_TARGET = 6; // practices per team, before league play (mirrors Schedule)
const LEAGUE_TARGET = 5; // league match weeks

const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const hhmm = (d: Date) => new Date(d).toISOString().slice(11, 16);

const OK: Record<string, string> = {
  generateFixtures: "Fixtures generated.",
  editFixture: "Fixture updated.",
  clearFixtures: "Fixtures cleared — regenerate when ready.",
  sendMatchNotice: "7-day match notice sent.",
  sendEscalationAlert: "48-hour alert sent.",
  createLeague: "New league created and set active.",
  addMatch: "Match scheduled.",
};

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage the league.",
  noseason: "No ACP season found.",
  nofixture: "Fixture not found.",
  norisk: "No teams are currently at risk — nothing to escalate.",
  leaguefields: "Enter a league name and both dates.",
  leaguedates: "Check the dates — the end must be on or after the start.",
  matchteams: "Pick both teams for the match.",
  matchsame: "A team can't play itself — pick two different teams.",
  matchdate: "Pick a date for the match.",
  op: "Unknown operation.",
};


export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  const facilities = await prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const acpTeams = season
    ? await prisma.team.findMany({ where: { seasonId: season.id }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  // --- Phase data --------------------------------------------------------
  const acpTeamCount = season ? await prisma.team.count({ where: { seasonId: season.id } }) : 0;

  // Practices: PRACTICE sessions scheduled for this season's teams.
  const practiceCount = season
    ? await prisma.session.count({ where: { seasonId: season.id, type: "PRACTICE" } })
    : 0;
  const practiceTarget = acpTeamCount * PRACTICE_TARGET;

  const fixtures = season
    ? await prisma.fixture.findMany({
        where: { seasonId: season.id },
        include: {
          homeTeam: { include: { members: true, division: true } },
          awayTeam: { include: { members: true } },
          facility: true,
          confirmations: true,
        },
        orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
        take: 200,
      })
    : [];

  const completedFixtures = fixtures.filter((f) => f.status === "COMPLETED" || f.status === "FORFEITED").length;
  const bracketCount = season
    ? await prisma.championshipMatch.count({ where: { seasonId: season.id } })
    : 0;

  const standings = season ? await seasonStandingsByDivision(season.id) : [];

  const now = new Date();

  // --- The ACP arc: one season, five phases ------------------------------
  const phases = [
    {
      key: "setup",
      title: "Season & teams",
      detail: season ? `${acpTeamCount} team${acpTeamCount === 1 ? "" : "s"} in ${season.name}` : "Create an ACP season",
      done: !!season && acpTeamCount >= 2,
      active: !season || acpTeamCount < 2,
      href: !season ? "/console/setup" : "/console/teams",
      cta: !season ? "Season Setup" : "Team Build",
    },
    {
      key: "practices",
      title: `${PRACTICE_TARGET} practices`,
      detail: practiceTarget > 0 ? `${practiceCount}/${practiceTarget} practice sessions scheduled` : "Set team day/time, then generate",
      done: practiceTarget > 0 && practiceCount >= practiceTarget,
      active: !!season && acpTeamCount >= 2 && (practiceTarget === 0 || practiceCount < practiceTarget),
      href: "/console/schedule",
      cta: "Schedule practices",
    },
    {
      key: "matches",
      title: `${LEAGUE_TARGET} league matches`,
      detail: fixtures.length > 0 ? `${fixtures.length} fixtures · ${completedFixtures} played` : "Generate the round-robin",
      done: fixtures.length > 0,
      active: !!season && acpTeamCount >= 2 && fixtures.length === 0,
      href: null,
      cta: "",
    },
    {
      key: "standings",
      title: "Results & standings",
      detail: fixtures.length > 0 ? `${completedFixtures}/${fixtures.length} matches recorded` : "Enter scores as matches play",
      done: fixtures.length > 0 && completedFixtures === fixtures.length,
      active: fixtures.length > 0 && completedFixtures < fixtures.length,
      href: null,
      cta: "",
    },
    {
      key: "tournament",
      title: "Year-end tournament",
      detail: bracketCount > 0 ? "Bracket drawn from standings" : "Seed a bracket from the leaderboard",
      done: bracketCount > 0,
      active: fixtures.length > 0 && completedFixtures > 0 && bracketCount === 0,
      href: "/console/championship",
      cta: "Set up tournament",
    },
  ];
  const currentPhase = phases.find((p) => p.active) ?? phases.find((p) => !p.done);
  const totalTeams = acpTeamCount;

  // Confirmation status per fixture (for the current/near window).
  const withStatus = fixtures.map((f) => {
    const teams = [f.homeTeam, f.awayTeam].filter(Boolean).map((team) => {
      const statuses = team!.members.map(
        (m) => f.confirmations.find((c) => c.personId === m.personId)?.status ?? "UNCONFIRMED"
      );
      const tc = teamConfirmation(team!.id, team!.name, team!.members.length, statuses);
      return { ...tc, atRisk: shouldEscalate(f.scheduledAt, now, tc) };
    });
    return { fixture: f, teams, anyRisk: teams.some((t) => t.atRisk) };
  });

  const upcoming = withStatus.filter(
    (w) => w.fixture.scheduledAt.getTime() > now.getTime() - 6 * 3.6e6 &&
      ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(w.fixture.status)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="ACP League" subtitle="One season, start to finish: six practices, a five-week round-robin, a live leaderboard, and a year-end tournament seeded from the standings." />

      <details className="card text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-800">How season, league, and championship fit together</summary>
        <ul className="mt-2 space-y-1.5">
          <li><span className="font-semibold text-slate-800">Season</span> — the container for a program run: it holds divisions, registrations, and the base fee. PURE Academy and Arizona Club Pickleball (ACP) each run their own seasons.</li>
          <li><span className="font-semibold text-slate-800">League</span> — the ACP competition inside a season: a round-robin of matches between teams that produces a live leaderboard. Creating one makes it the active ACP league.</li>
          <li><span className="font-semibold text-slate-800">Championship</span> — the year-end playoff bracket, seeded from the league standings once the round-robin is done.</li>
        </ul>
      </details>

      {sp.ok && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok] ?? "Done."}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>
      )}

      {/* The season arc — one continuous flow, current phase highlighted */}
      <div className="card">
        <h2 className="h-sport mb-4 text-lg">The season arc</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {phases.map((p, i) => {
            const state = p.done ? "done" : p.active ? "active" : "todo";
            return (
              <li
                key={p.key}
                className={`relative rounded-xl border p-3 ${
                  state === "active"
                    ? "border-accent-400 bg-accent-50/60 ring-1 ring-accent-300"
                    : state === "done"
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      state === "done"
                        ? "bg-emerald-500 text-white"
                        : state === "active"
                        ? "bg-brand-900 text-white"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{p.title}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{p.detail}</p>
                {state === "active" && p.href && (
                  <Link href={p.href} className="mt-2 inline-block text-xs font-semibold text-accent-700 underline">
                    {p.cta} →
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        {currentPhase && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <p className="text-sm text-slate-600">
              Next up: <span className="font-semibold text-slate-800">{currentPhase.title}</span>
              {currentPhase.detail ? <span className="text-slate-500"> — {currentPhase.detail}</span> : null}
            </p>
            {currentPhase.href && (
              <Link href={currentPhase.href} className="btn-primary text-sm">{currentPhase.cta} →</Link>
            )}
          </div>
        )}
      </div>

      {!season && (
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold text-slate-900">Create a new league</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Start an <span className="font-medium">Arizona Club Pickleball</span> league. It becomes the active league, then
              add teams in <Link href="/console/teams" className="text-accent-700 underline">Team Build</Link> and schedule matches here.
            </p>
          </div>
          <CreateLeagueForm ticket={ticket} />
        </div>
      )}

      {/* Practices phase summary */}
      {season && acpTeamCount >= 2 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Practices</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {practiceTarget > 0
                  ? `${practiceCount} of ${practiceTarget} practice sessions scheduled (${PRACTICE_TARGET} per team).`
                  : `Set each team's day, time, and facility, then generate ${PRACTICE_TARGET} practices per team.`}
              </p>
            </div>
            <Link href="/console/schedule" className="btn-secondary text-sm">Manage practices →</Link>
          </div>
          {practiceTarget > 0 && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-accent-500" style={{ width: `${Math.min(100, (practiceCount / practiceTarget) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Generate fixtures */}
      {season && acpTeamCount >= 2 && fixtures.length === 0 && (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-900">Generate league fixtures</h2>
          <p className="mb-3 text-sm text-slate-500">
            Round-robin across {LEAGUE_TARGET} league weeks from {formatDate(season.startDate)}, skipping
            blackout weeks. {totalTeams} team(s) in the season.
          </p>
          <form method="POST" action="/api/console/league">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="generateFixtures" />
            <input type="hidden" name="seasonId" value={season.id} />
            <button className="btn-primary">Generate fixtures</button>
          </form>
        </div>
      )}

      {/* 48-hour confirmation dashboard */}
      {upcoming.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Confirmation dashboard</h2>
          <p className="mb-3 text-sm text-slate-500">
            Every fixture&apos;s confirmed players. A team below {MIN_CONFIRMED_PLAYERS} confirmed inside 48
            hours is at risk of forfeit — alert the coach, Director, and COO.
          </p>
          <div className="space-y-3">
            {upcoming.map(({ fixture: f, teams, anyRisk }) => (
              <div key={f.id} className={`rounded-lg border p-3 ${anyRisk ? "border-rose-300 bg-rose-50/40" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{f.homeTeam?.name} vs {f.awayTeam?.name}</span>
                    <span className="ml-2 text-xs text-slate-400">Wk {f.weekNumber} · {formatDate(f.scheduledAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    <form method="POST" action="/api/console/league">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="sendMatchNotice" />
                      <input type="hidden" name="fixtureId" value={f.id} />
                      <button className="btn-ghost text-xs">Send 7-day notice</button>
                    </form>
                    {anyRisk && (
                      <form method="POST" action="/api/console/league">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="sendEscalationAlert" />
                        <input type="hidden" name="fixtureId" value={f.id} />
                        <button className="btn-secondary text-xs text-rose-700 ring-rose-200 hover:bg-rose-50">Send 48h alert</button>
                      </form>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {teams.map((t) => (
                    <div key={t.teamId} className="flex items-center justify-between rounded bg-white px-3 py-2 text-sm ring-1 ring-slate-100">
                      <span className="text-slate-700">{t.teamName}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className={t.enough ? "text-emerald-700" : "text-rose-700 font-medium"}>
                          {t.confirmedPlaying}/{MIN_CONFIRMED_PLAYERS} playing
                        </span>
                        <span className="text-slate-400">{t.unconfirmed} unconfirmed</span>
                        {t.atRisk && <span className="badge bg-rose-100 text-rose-800">at risk</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard — the live standings that seed the tournament */}
      {standings.length > 0 && (
        <div className="space-y-4">
          {standings.map((div) => (
            <div key={div.divisionId} className="card overflow-x-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Leaderboard — {div.divisionName}</h2>
                <span className="text-xs text-slate-400">Ranked by match points, then lines, then games</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-2 pr-2">#</th>
                    <th>Team</th>
                    <th className="text-center">P</th>
                    <th className="text-center">W</th>
                    <th className="text-center">L</th>
                    <th className="text-center">Lines</th>
                    <th className="text-center">Games</th>
                    <th className="text-center">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {div.rows.map((r, i) => (
                    <tr key={r.teamId} className={i < 2 ? "bg-accent-50/40" : ""}>
                      <td className="py-2 pr-2 font-semibold text-slate-500">{i + 1}</td>
                      <td className="font-medium text-slate-800">
                        {r.teamName}
                        {i < 2 && <span className="ml-2 badge bg-accent-100 text-accent-800">seed</span>}
                        {r.forfeits > 0 && <span className="ml-2 text-xs text-rose-500">{r.forfeits} forfeit{r.forfeits > 1 ? "s" : ""}</span>}
                      </td>
                      <td className="text-center text-slate-600 tabular-nums">{r.played}</td>
                      <td className="text-center text-slate-600 tabular-nums">{r.matchesWon}</td>
                      <td className="text-center text-slate-600 tabular-nums">{r.matchesLost}</td>
                      <td className="text-center text-slate-500 tabular-nums">{r.linesWon}–{r.linesLost}</td>
                      <td className="text-center text-slate-500 tabular-nums">{r.gamesWon}–{r.gamesLost}</td>
                      <td className="text-center font-bold text-slate-900 tabular-nums">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {completedFixtures > 0 && (
            <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-accent-500">
              <div>
                <h2 className="font-semibold text-slate-900">Year-end tournament</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Seed a single-elimination bracket from these standings. Top teams get the top seeds; byes auto-advance.
                </p>
              </div>
              <Link href="/console/championship" className="btn-primary text-sm">
                {bracketCount > 0 ? "Manage tournament →" : "Set up tournament →"}
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Eligible teams + manually schedule a match */}
      {season && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">Eligible teams</h2>
            <span className="text-xs text-slate-400">{acpTeams.length} team{acpTeams.length === 1 ? "" : "s"} in {season.name}</span>
          </div>
          {acpTeams.length === 0 ? (
            <p className="text-sm text-slate-500">
              No teams in this league yet. Build teams in <Link href="/console/teams" className="text-accent-700 underline">Team Build</Link>,
              then schedule matches between them here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {acpTeams.map((t) => (
                <span key={t.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{t.name}</span>
              ))}
            </div>
          )}

          {acpTeams.length >= 2 && (
            <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-100">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Schedule a match</h3>
              <form method="POST" action="/api/console/league" className="grid gap-3 sm:grid-cols-6 sm:items-end">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="addMatch" />
                <input type="hidden" name="seasonId" value={season.id} />
                <div className="sm:col-span-2">
                  <label className="label">Home team</label>
                  <select name="homeTeamId" className="input" required>
                    <option value="">—</option>
                    {acpTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Away team</label>
                  <select name="awayTeamId" className="input" required>
                    <option value="">—</option>
                    {acpTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date</label>
                  <input name="scheduledAt" type="date" className="input" required />
                </div>
                <div>
                  <label className="label">Time</label>
                  <input name="scheduledTime" type="time" className="input" defaultValue="18:00" />
                </div>
                <div className="sm:col-span-4">
                  <label className="label">Location</label>
                  <select name="facilityId" className="input">
                    <option value="">Hub TBD</option>
                    {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <button className="btn-primary w-full">Schedule match</button>
                </div>
              </form>
              <p className="mt-2 text-xs text-slate-400">
                Adds one match to the fixtures below. Enter scores on the match page once it&apos;s played — the leaderboard updates automatically.
              </p>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-slate-600">Create another league</summary>
            <div className="mt-3">
              <CreateLeagueForm ticket={ticket} />
            </div>
          </details>
        </div>
      )}

      {/* All fixtures */}
      <div className="card overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Fixtures</h2>
          {season && fixtures.length > 0 && (
            <form method="POST" action="/api/console/league">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="clearFixtures" />
              <input type="hidden" name="seasonId" value={season.id} />
              <button className="text-xs text-rose-600 hover:underline">Clear &amp; regenerate</button>
            </form>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr><th className="py-2">Wk</th><th className="hidden sm:table-cell">Date</th><th>Home</th><th>Away</th><th className="hidden md:table-cell">Hub</th><th>Status</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fixtures.map((f) => (
              <EditableFixtureRow
                key={f.id}
                ticket={ticket}
                facilities={facilities}
                teams={acpTeams}
                fixture={{
                  id: f.id,
                  weekNumber: f.weekNumber,
                  dateISO: iso(f.scheduledAt),
                  timeHHMM: hhmm(f.scheduledAt),
                  dateLabel: formatDate(f.scheduledAt),
                  home: f.homeTeam?.name ?? "TBD",
                  away: f.awayTeam?.name ?? "TBD",
                  homeTeamId: f.homeTeamId ?? null,
                  awayTeamId: f.awayTeamId ?? null,
                  facilityId: f.facilityId ?? null,
                  facilityName: f.facility?.name ?? "—",
                  status: f.status,
                }}
              />
            ))}
            {fixtures.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">No fixtures generated yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
