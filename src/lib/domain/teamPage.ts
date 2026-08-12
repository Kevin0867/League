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

export type TeamFixtureView = {
  id: string;
  weekNumber: number;
  scheduledAt: Date;
  status: string;
  isHome: boolean;
  opponentName: string;
  opponentSlug: string | null;
  facilityName: string | null;
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
  roster: { id: string; label: string; slug: string }[];
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
          include: { person: { select: { id: true, firstName: true, lastName: true } } },
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
      },
      orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
    }),
  ]);
  if (!team) return null;

  // League record — find this team's row in the active ACP league ladder.
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  const ladder = season ? await leagueStandingsFlat(season.id) : [];
  const record = ladder.find((r) => r.teamId === team.id) ?? null;

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
    };
  };

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
    roster: team.members.map((m) => ({
      id: m.person.id,
      label: publicPlayerName(m.person),
      slug: publicPlayerSlug(m.person, m.person.id),
    })),
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
