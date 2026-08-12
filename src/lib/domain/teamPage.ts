// Data for a public team page (build-list §7). Resolves a published PURE team
// by its derived slug, then gathers the club-facing view: roster, coach,
// weekly practice, league record, and fixtures. The slug is derived from the
// identity parts, so we match against teamSlug() rather than store a slug.
import { prisma } from "@/lib/db";
import { teamDisplayName, teamSlug } from "@/lib/domain/teamName";
import { leagueStandingsFlat, type LeagueStandingRow } from "@/lib/domain/leagueStandings";
import { publicPlayerName, publicPlayerSlug } from "@/lib/domain/publicPlayer";

const DAY_LABEL: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday",
  FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

export type LineupLine = {
  lineNumber: number;
  isExhibition: boolean;
  ourPair: string | null; // "Kevin B. / Sam R." — masked
  theirPair: string | null;
  games: { our: number; their: number }[];
  result: "won" | "lost" | "pending";
};

export type TeamFixtureView = {
  id: string;
  weekNumber: number;
  scheduledAt: Date;
  status: string;
  isHome: boolean;
  opponentName: string;
  opponentSlug: string | null;
  facilityName: string | null;
  lines: LineupLine[]; // the line-up card — empty until a line-up/scores exist
};

export type RosterPlayer = {
  id: string;
  label: string; // first name + last initial
  slug: string;
  dupr: number | null; // adults only
  line: number | null; // current doubles position, null until set
};

export type TeamPageData = {
  id: string;
  displayName: string;
  shortMarket: string | null;
  divisionCode: string | null;
  color: string | null;
  practice: { day: string | null; startTime: string | null; facility: string | null };
  coachName: string | null;
  coachPersonId: string | null;
  roster: RosterPlayer[];
  combinedDupr: number | null; // sum of adult ratings
  avgDupr: number | null;
  record: LeagueStandingRow | null;
  upcoming: TeamFixtureView[];
  recent: TeamFixtureView[];
};

export async function resolveTeamBySlug(slug: string) {
  // Small candidate set: only published PURE teams have public pages. Match on
  // the derived slug so identity edits never orphan a URL silently.
  const candidates = await prisma.team.findMany({
    where: { club: "PURE", published: true },
    select: { id: true, club: true, market: true, divisionCode: true, color: true, name: true },
  });
  return candidates.find((t) => teamSlug(t) === slug) ?? null;
}

export async function getTeamPageData(slug: string): Promise<TeamPageData | null> {
  const match = await resolveTeamBySlug(slug);
  if (!match) return null;

  const [team, fixtures] = await Promise.all([
    prisma.team.findUnique({
      where: { id: match.id },
      include: {
        facility: { select: { name: true } },
        coach: { include: { person: { select: { id: true, firstName: true, lastName: true } } } },
        teamContact: { select: { firstName: true, lastName: true } },
        members: {
          include: { person: { select: { id: true, firstName: true, lastName: true, isMinor: true, duprRating: true } } },
          orderBy: { person: { firstName: "asc" } },
        },
      },
    }),
    prisma.fixture.findMany({
      where: { OR: [{ homeTeamId: match.id }, { awayTeamId: match.id }] },
      include: {
        facility: { select: { name: true } },
        homeTeam: { select: { club: true, market: true, divisionCode: true, color: true, name: true, published: true } },
        awayTeam: { select: { club: true, market: true, divisionCode: true, color: true, name: true, published: true } },
        lines: { select: { lineNumber: true, isCounting: true, lineWinner: true, games: { select: { gameNumber: true, homeScore: true, awayScore: true } } } },
      },
      orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
    }),
  ]);
  if (!team) return null;

  // Line-ups: pairings for this team and every opponent, across all played
  // weeks, so a fixture's line-up card can name both pairs (masked). Indexed by
  // team|week|rank.
  const oppIds = [
    ...new Set(fixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId]).filter((x): x is string => !!x && x !== team.id)),
  ];
  const weeks = [...new Set(fixtures.map((f) => f.weekNumber))];
  const pairings = weeks.length
    ? await prisma.pairing.findMany({
        where: { teamId: { in: [team.id, ...oppIds] }, weekNumber: { in: weeks } },
        include: {
          playerA: { select: { firstName: true, lastName: true } },
          playerB: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const pairIndex = new Map<string, (typeof pairings)[number]>();
  for (const pr of pairings) pairIndex.set(`${pr.teamId}|${pr.weekNumber}|${pr.rank}`, pr);
  const pairLabel = (pr: (typeof pairings)[number] | undefined) =>
    pr ? `${publicPlayerName(pr.playerA)} / ${publicPlayerName(pr.playerB)}` : null;

  // League record — find this team's row in the active ACP league ladder.
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  const ladder = season ? await leagueStandingsFlat(season.id) : [];
  const record = ladder.find((r) => r.teamId === team.id) ?? null;

  const buildLines = (f: (typeof fixtures)[number], isHome: boolean): LineupLine[] => {
    const oppId = isHome ? f.awayTeamId : f.homeTeamId;
    const out: LineupLine[] = [];
    for (let rank = 1; rank <= 4; rank++) {
      const our = pairIndex.get(`${team.id}|${f.weekNumber}|${rank}`);
      const their = oppId ? pairIndex.get(`${oppId}|${f.weekNumber}|${rank}`) : undefined;
      const lm = f.lines.find((l) => l.lineNumber === rank);
      if (!our && !their && !lm) continue;
      const isExhibition = rank === 4 || (lm ? !lm.isCounting : false);
      const games = (lm?.games ?? [])
        .sort((a, b) => a.gameNumber - b.gameNumber)
        .map((g) => ({ our: isHome ? g.homeScore : g.awayScore, their: isHome ? g.awayScore : g.homeScore }));
      let result: LineupLine["result"] = "pending";
      if (lm?.lineWinner) result = lm.lineWinner === (isHome ? "HOME" : "AWAY") ? "won" : "lost";
      out.push({ lineNumber: rank, isExhibition, ourPair: pairLabel(our), theirPair: pairLabel(their), games, result });
    }
    return out;
  };

  const toView = (f: (typeof fixtures)[number]): TeamFixtureView => {
    const isHome = f.homeTeamId === team.id;
    const opp = isHome ? f.awayTeam : f.homeTeam;
    return {
      id: f.id,
      weekNumber: f.weekNumber,
      scheduledAt: f.scheduledAt,
      status: f.status,
      isHome,
      opponentName: opp ? teamDisplayName(opp) || opp.name : "TBD",
      opponentSlug: opp && opp.club === "PURE" && opp.published ? teamSlug(opp) : null,
      facilityName: f.facility?.name ?? null,
      lines: buildLines(f, isHome),
    };
  };

  // Doubles position per player — the rank of their most recent pairing for this team.
  const myPairings = [...pairings].filter((p) => p.teamId === team.id).sort((a, b) => a.weekNumber - b.weekNumber);
  const lineOf = new Map<string, number>();
  for (const p of myPairings) {
    lineOf.set(p.playerAId, p.rank);
    lineOf.set(p.playerBId, p.rank);
  }

  // Roster with adult DUPR + doubles position; ordered by line once any is set.
  const rosterPlayers: RosterPlayer[] = team.members.map((m) => ({
    id: m.person.id,
    label: publicPlayerName(m.person),
    slug: publicPlayerSlug(m.person, m.person.id),
    dupr: !m.person.isMinor && m.person.duprRating != null ? m.person.duprRating : null,
    line: lineOf.get(m.person.id) ?? null,
  }));
  if (rosterPlayers.some((r) => r.line != null)) {
    rosterPlayers.sort((a, b) => (a.line ?? 99) - (b.line ?? 99) || a.label.localeCompare(b.label));
  }

  // Combined + average DUPR across adult, rated players.
  const ratings = team.members.filter((m) => !m.person.isMinor && m.person.duprRating != null).map((m) => m.person.duprRating!);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const combinedDupr = ratings.length ? round3(ratings.reduce((s, x) => s + x, 0)) : null;
  const avgDupr = ratings.length ? round3(ratings.reduce((s, x) => s + x, 0) / ratings.length) : null;

  const upcoming = fixtures
    .filter((f) => ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(f.status))
    .map(toView);
  const recent = fixtures
    .filter((f) => ["COMPLETED", "FORFEITED"].includes(f.status))
    .map(toView)
    .reverse();

  const coachName = team.coach
    ? `${team.coach.person.firstName} ${team.coach.person.lastName}`
    : team.teamContact
    ? `${team.teamContact.firstName} ${team.teamContact.lastName}`
    : null;

  return {
    id: team.id,
    displayName: teamDisplayName(team) || team.name,
    shortMarket: team.market,
    divisionCode: team.divisionCode,
    color: team.color,
    practice: {
      day: team.dayOfWeek ? DAY_LABEL[team.dayOfWeek] ?? team.dayOfWeek : null,
      startTime: team.startTime,
      facility: team.facility?.name ?? null,
    },
    coachName,
    coachPersonId: team.coach?.person.id ?? null,
    roster: rosterPlayers,
    combinedDupr,
    avgDupr,
    record,
    upcoming,
    recent,
  };
}

/// All published PURE team slugs — for the sitemap and static hints.
export async function allTeamSlugs(): Promise<string[]> {
  const teams = await prisma.team.findMany({
    where: { club: "PURE", published: true },
    select: { club: true, market: true, divisionCode: true, color: true },
  });
  return teams.map(teamSlug);
}
