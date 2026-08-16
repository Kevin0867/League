import Link from "next/link";
import { formatDate } from "@/lib/time";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket, getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CoachLeagueMatches } from "./CoachLeagueMatches";
import { teamConfirmation, shouldEscalate, MIN_CONFIRMED_PLAYERS } from "@/lib/domain/availability";
import { EditableFixtureRow } from "@/components/EditableFixtureRow";
import { leagueStandingsFlat } from "@/lib/domain/leagueStandings";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CreateLeagueForm } from "./CreateLeagueForm";
import { MATCH_TYPES, matchTypeShort } from "@/lib/domain/matchType";
import { ScoringFormatFields } from "@/components/ScoringFormatFields";
import { DEFAULT_SCORING, scoringFormatOf, scoringShort } from "@/lib/domain/scoringFormat";

export const dynamic = "force-dynamic";

const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const hhmm = (d: Date) => new Date(d).toISOString().slice(11, 16);

const OK: Record<string, string> = {
  generateFixtures: "Round-robin generated — every team plays every other team.",
  editFixture: "Match updated.",
  clearFixtures: "Matches cleared — schedule or regenerate when ready.",
  sendMatchNotice: "Match notice sent to both teams.",
  sendEscalationAlert: "48-hour alert sent.",
  createLeague: "New league created and set active.",
  addMatch: "Match scheduled — assign teams later by editing the row if you left them TBD.",
  proposeScores: "Scores submitted for the other team to accept.",
  acceptScores: "Scores accepted — result is final.",
  disputeScores: "Scores disputed — enter the official result to resolve.",
  addLeagueTeam: "Team added to the league.",
  removeLeagueTeam: "Team removed from the league.",
  setScoringFormat: "Scoring format updated.",
};

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage the league.",
  noseason: "No active league — create one first.",
  noteam: "Pick a team.",
  notpublished: "Only published teams can join the league. Publish it in Team Build first.",
  nofixture: "Match not found.",
  norisk: "No teams are currently at risk — nothing to escalate.",
  leaguefields: "Enter a league name and both dates.",
  leaguedates: "Check the dates — the end must be on or after the start.",
  matchteams: "Pick both teams for the match.",
  matchsame: "A team can't play itself — pick two different teams.",
  matchdate: "Pick a date for the match.",
  notyours: "You can only enter or confirm scores for your own team's matches.",
  fewteams: "Add at least two teams to the league before generating matches.",
  hasfixtures: "Matches already exist — clear them first to regenerate.",
  op: "Unknown operation.",
};

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  // Coaches see a focused view of only their teams' matches (enter scores,
  // accept/dispute the opponent's). Scheduling admins get the full hub below.
  const session = await getSession();
  const roles = session?.roles ?? (session?.role ? [session.role] : []);
  if (!can(roles, "manageScheduling")) {
    return (
      <div className="space-y-6">
        {sp.ok && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok] ?? "Done."}</p>}
        {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}
        <CoachLeagueMatches personId={session?.personId ?? ""} ticket={ticket} />
      </div>
    );
  }

  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });

  if (!season) {
    return (
      <div className="space-y-6">
        <PageHeader title="ACP League" subtitle="Add your published teams, schedule matches, enter scores — the leaderboard builds itself." />
        {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold text-slate-900">Create your league</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              A league is a round-robin of matches between teams that produces a live leaderboard. Create one to
              get started — then add any of your published teams to it.
            </p>
          </div>
          <CreateLeagueForm ticket={ticket} />
        </div>
      </div>
    );
  }

  const [leagueEntries, facilities, fixtures, standings] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { seasonId: season.id },
      include: { team: { select: { id: true, name: true, published: true, facility: { select: { name: true } } } } },
      orderBy: { team: { name: "asc" } },
    }),
    prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.fixture.findMany({
      where: { seasonId: season.id },
      include: {
        homeTeam: { include: { members: true } },
        awayTeam: { include: { members: true } },
        facility: true,
        confirmations: true,
      },
      orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
      take: 200,
    }),
    leagueStandingsFlat(season.id),
  ]);

  const rosterTeams = leagueEntries.map((e) => e.team);
  const rosterIds = rosterTeams.map((t) => t.id);
  // Any team not yet in the league — the pool to add from. No publish
  // requirement: teams can join before they're fully set up.
  const availableTeams = await prisma.team.findMany({
    where: { id: { notIn: rosterIds.length ? rosterIds : ["__none__"] } },
    select: { id: true, name: true, published: true, origin: true, division: { select: { name: true } }, facility: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const completedFixtures = fixtures.filter((f) => f.status === "COMPLETED" || f.status === "FORFEITED").length;
  const now = new Date();

  // Simple three-step progress reflecting exactly what an admin does here.
  const steps = [
    { n: 1, label: "Add teams", done: rosterTeams.length >= 2, detail: `${rosterTeams.length} in the league` },
    { n: 2, label: "Set matches", done: fixtures.length > 0, detail: fixtures.length > 0 ? `${fixtures.length} scheduled` : "none yet" },
    { n: 3, label: "Enter scores", done: fixtures.length > 0 && completedFixtures === fixtures.length, detail: `${completedFixtures}/${fixtures.length || 0} played` },
  ];

  // Confirmation status per fixture (upcoming window only).
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

  const rosterForRows = rosterTeams.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="space-y-6">
      <PageHeader title={season.name} subtitle="Add your published teams, schedule matches, enter scores — the leaderboard builds itself." />

      {sp.ok && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok] ?? "Done."}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {/* Three-step guide — exactly the flow: add teams → set matches → enter scores */}
      <div className="card">
        <ol className="grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className={`flex items-center gap-3 rounded-xl border p-3 ${s.done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200"}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${s.done ? "bg-emerald-500 text-white" : "bg-brand-900 text-white"}`}>
                {s.done ? "✓" : s.n}
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-800">{s.label}</div>
                <div className="text-xs text-slate-500">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* STEP 1 — Teams in the league */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900"><span className="text-slate-400">Step 1 ·</span> Teams in the league</h2>
            <p className="mt-0.5 text-sm text-slate-500">Add any team — it doesn&apos;t need to be published or fully set up. Every team you add plays in the round-robin and appears on the leaderboard.</p>
          </div>
          <span className="text-xs text-slate-400">{rosterTeams.length} team{rosterTeams.length === 1 ? "" : "s"}</span>
        </div>

        {rosterTeams.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            No teams in the league yet. Add teams from the list below.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-100">
            {rosterTeams.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {t.name}
                  <span className="ml-2 text-xs font-normal text-slate-400">{t.facility?.name ?? "hub TBD"}</span>
                </span>
                <ConfirmSubmit
                  action="/api/console/league"
                  fields={{ ticket, op: "removeLeagueTeam", seasonId: season.id, teamId: t.id }}
                  label="Remove"
                  confirm={`Remove ${t.name} from the league? Existing matches stay on the record — clear & regenerate to rebuild the round-robin without it.`}
                  className="btn-ghost text-xs text-rose-600"
                />
              </li>
            ))}
          </ul>
        )}

        {/* Add teams — any team, published or not */}
        <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Add a team</h3>
            {availableTeams.length > 0 && (
              <form method="POST" action="/api/console/league">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="addAllLeagueTeams" />
                <input type="hidden" name="seasonId" value={season.id} />
                <button className="btn-secondary text-xs">Add all {availableTeams.length} teams</button>
              </form>
            )}
          </div>
          {availableTeams.length === 0 ? (
            <p className="text-sm text-slate-500">
              {rosterTeams.length > 0
                ? "Every team is already in the league."
                : <>No teams exist yet. Build teams in <Link href="/console/teams" className="text-accent-700 underline">Team Build</Link>, or convert an <Link href="/console/acp" className="text-accent-700 underline">ACP entry</Link> into a team, then add them here.</>}
            </p>
          ) : (
            <form method="POST" action="/api/console/league" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="addLeagueTeam" />
              <input type="hidden" name="seasonId" value={season.id} />
              <div>
                <label className="label">Team</label>
                <select name="teamId" className="input min-w-[16rem]" required>
                  <option value="">Choose a team…</option>
                  {availableTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.division?.name ? ` · ${t.division.name}` : ""}
                      {t.facility?.name ? ` · ${t.facility.name}` : ""}
                      {t.published ? "" : " · draft"}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-primary">Add to league</button>
            </form>
          )}
        </div>
      </div>

      {/* STEP 2 — Matches */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900"><span className="text-slate-400">Step 2 ·</span> Matches</h2>
            <p className="mt-0.5 text-sm text-slate-500">Lock in a date, time, and location — teams optional. Assign teams later by editing the row, or generate a full round-robin once every team is in.</p>
          </div>
          {fixtures.length > 0 && (
            <ConfirmSubmit
              action="/api/console/league"
              fields={{ ticket, op: "clearFixtures", seasonId: season.id }}
              label="Clear all matches"
              confirm="Delete every scheduled match for this league? Scores already entered will be lost. This can't be undone."
              danger
              className="text-xs text-rose-600 hover:underline"
            />
          )}
        </div>

        {
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Schedule one match or slot — teams optional */}
              <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-100">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Schedule a match or slot</h3>
                <form method="POST" action="/api/console/league" className="grid gap-3">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="addMatch" />
                  <input type="hidden" name="seasonId" value={season.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Home team <span className="font-normal text-slate-400">(optional)</span></label>
                      <select name="homeTeamId" className="input">
                        <option value="">— TBD —</option>
                        {rosterTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Away team <span className="font-normal text-slate-400">(optional)</span></label>
                      <select name="awayTeamId" className="input">
                        <option value="">— TBD —</option>
                        {rosterTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
                    <div>
                      <label className="label">Location</label>
                      <select name="facilityId" className="input">
                        <option value="">Hub TBD</option>
                        {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Courts <span className="font-normal text-slate-400">(optional)</span></label>
                      <input name="courtAllocation" className="input" placeholder="e.g. Courts 1–4" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Match type</label>
                      <select name="matchType" className="input" defaultValue="TEAM_3">
                        {MATCH_TYPES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <details className="rounded-lg border border-slate-200 bg-white p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">Scoring format <span className="font-normal text-slate-400">(default: best 2 of 3 to 11, win by 2)</span></summary>
                    <div className="mt-3">
                      <ScoringFormatFields value={DEFAULT_SCORING} />
                    </div>
                  </details>
                  <button className="btn-primary w-full sm:w-auto">Schedule</button>
                  <p className="text-xs text-slate-400">Leave the teams as TBD to secure a location and time now, then drop teams in from the table below.</p>
                </form>
              </div>

              {/* Generate round-robin */}
              <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-100">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Generate a full round-robin</h3>
                <p className="mb-3 text-sm text-slate-600">
                  Auto-schedule every pairing across the league weeks from {formatDate(season.startDate)}, skipping blackout dates.
                  Best as a starting point — you can edit any match afterward.
                </p>
                {rosterTeams.length < 2 ? (
                  <p className="text-sm text-slate-500">Add at least two teams above to generate the round-robin.</p>
                ) : fixtures.length > 0 ? (
                  <p className="text-sm text-slate-500">
                    Matches already scheduled. <span className="text-slate-400">Clear all matches to regenerate.</span>
                  </p>
                ) : (
                  <form method="POST" action="/api/console/league">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="generateFixtures" />
                    <input type="hidden" name="seasonId" value={season.id} />
                    <button className="btn-primary">Generate round-robin ({rosterTeams.length} teams)</button>
                  </form>
                )}
              </div>
            </div>

            {/* Fixtures table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr><th className="py-2">Wk</th><th className="hidden sm:table-cell">Date</th><th>Home</th><th>Away</th><th className="hidden lg:table-cell">Type</th><th className="hidden md:table-cell">Location</th><th>Status</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fixtures.map((f) => (
                    <EditableFixtureRow
                      key={f.id}
                      ticket={ticket}
                      facilities={facilities}
                      teams={rosterForRows}
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
                        matchType: f.matchType,
                        matchTypeShort: matchTypeShort(f.matchType),
                        scoringShort: scoringShort(scoringFormatOf(f)),
                        courtAllocation: f.courtAllocation ?? null,
                        scoreStatus: f.scoreStatus,
                        status: f.status,
                      }}
                    />
                  ))}
                  {fixtures.length === 0 && (
                    <tr><td colSpan={8} className="py-8 text-center text-slate-400">No matches yet — schedule a slot or generate the round-robin above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">
              Enter scores on a match&apos;s own page (open it from the Status column) — the leaderboard below updates automatically.
            </p>
          </>
        }
      </div>

      {/* Confirmation dashboard — availability risk for upcoming matches */}
      {upcoming.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Availability for upcoming matches</h2>
          <p className="mb-3 text-sm text-slate-500">
            A team below {MIN_CONFIRMED_PLAYERS} confirmed players inside 48 hours is at risk of forfeit — send the alert to the coach and admins.
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
                      <button className="btn-ghost text-xs">Send match notice</button>
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

      {/* STEP 3 — Leaderboard */}
      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900"><span className="text-slate-400">Step 3 ·</span> Leaderboard</h2>
            <p className="mt-0.5 text-sm text-slate-500">Live standings from entered scores. Ranked by match points, then line differential, then point differential. The top three lines decide each match — line 4 is an exhibition and counts toward nothing.</p>
          </div>
          <span className="text-xs text-slate-400">{completedFixtures}/{fixtures.length || 0} matches played</span>
        </div>
        {standings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            Add teams to see them on the leaderboard. Standings fill in as scores are entered.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th>Team</th>
                <th className="text-center">P</th>
                <th className="text-center">W</th>
                <th className="text-center">L</th>
                <th className="text-center">Lines</th>
                <th className="text-center" title="Point differential across counting lines">Diff</th>
                <th className="text-center">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {standings.map((r, i) => {
                const diff = r.pointsFor - r.pointsAgainst;
                return (
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
                  <td className={`text-center tabular-nums ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-500"}`}>{diff > 0 ? `+${diff}` : diff}</td>
                  <td className="text-center font-bold text-slate-900 tabular-nums">{r.points}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Year-end tournament — seeded from the leaderboard once matches are played */}
      {completedFixtures > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-accent-500">
          <div>
            <h2 className="font-semibold text-slate-900">Year-end tournament</h2>
            <p className="mt-0.5 text-sm text-slate-500">Seed a single-elimination bracket from the leaderboard. Top teams get the top seeds.</p>
          </div>
          <Link href="/console/championship" className="btn-primary text-sm">Set up tournament →</Link>
        </div>
      )}

      <details className="card text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-800">How season, league, and championship fit together</summary>
        <ul className="mt-2 space-y-1.5">
          <li><span className="font-semibold text-slate-800">Season</span> — the container for a program run: divisions, registrations, and the base fee.</li>
          <li><span className="font-semibold text-slate-800">League</span> — the competition inside a season: the published teams you add here play a round-robin that produces a live leaderboard.</li>
          <li><span className="font-semibold text-slate-800">Championship</span> — the year-end playoff bracket, seeded from the league standings once matches are played.</li>
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer font-medium text-slate-600">Start a different league</summary>
          <div className="mt-3"><CreateLeagueForm ticket={ticket} /></div>
        </details>
      </details>
    </div>
  );
}
