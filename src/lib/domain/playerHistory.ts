import "server-only";
import { prisma } from "@/lib/db";
import { teamDisplayName, teamShortName, teamSlug } from "@/lib/domain/teamName";
import { publicPlayerName, publicPlayerSlug } from "@/lib/domain/publicPlayer";

// Public player profile data (Community Layer §3.1). Everything here is derived
// from the same match/game records the standings use — never a stored total.
// A player's line ("doubles position") is the RANK of the Pairing bearing their
// id for a given week; their played line joins to the scored LineMatchup by
// rank === lineNumber within that week's fixture. Line 4 is exhibition and never
// counts toward the record (mirrors computeStandings).

type TeamIdentity = { id: string; club: string; market: string | null; divisionCode: string | null; color: string | null };

export type PlayerMatch = {
  fixtureId: string;
  weekNumber: number;
  date: Date;
  status: string;
  lineNumber: number;
  isExhibition: boolean;
  opponentName: string;
  opponentSlug: string | null;
  partnerName: string | null;
  opponentPair: string | null;
  games: { playerScore: number; opponentScore: number }[];
  result: "won" | "lost" | "pending";
};

export type PlayerProfile = {
  personId: string;
  slug: string;
  displayName: string;
  isMinor: boolean;
  dupr: number | null; // null unless adult + rated
  teamName: string | null;
  teamShort: string | null;
  teamSlug: string | null;
  market: string | null;
  divisionCode: string | null;
  color: string | null;
  coachName: string | null;
  coachPersonId: string | null;
  currentLine: number | null; // most recent line, null if none set yet
  commonLine: number | null; // most-played line
  linesPlayed: number; // counting lines only
  linesWon: number;
  linesLost: number;
  gamesWon: number;
  gamesLost: number;
  matches: PlayerMatch[]; // most recent first
};

function idOf(t: TeamIdentity) {
  return teamSlug(t);
}

/**
 * Build a public player profile, or null when the person isn't a rostered player
 * on a published team (no public page for unpublished/non-rostered people).
 */
export async function getPlayerProfile(personId: string): Promise<PlayerProfile | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, firstName: true, lastName: true, isMinor: true, duprRating: true },
  });
  if (!person) return null;

  // Primary team: a published team the player is rostered on.
  const membership = await prisma.teamMember.findFirst({
    where: { personId, team: { published: true } },
    include: {
      team: {
        select: {
          id: true, club: true, market: true, divisionCode: true, color: true,
          coach: { select: { person: { select: { id: true, firstName: true, lastName: true } } } },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });
  if (!membership) return null;
  const team = membership.team;

  // All of this player's pairings (line-ups), any week.
  const pairings = await prisma.pairing.findMany({
    where: { OR: [{ playerAId: personId }, { playerBId: personId }] },
    include: {
      playerA: { select: { id: true, firstName: true, lastName: true } },
      playerB: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { weekNumber: "asc" },
  });

  const teamIds = [...new Set(pairings.map((p) => p.teamId))];
  const weeks = [...new Set(pairings.map((p) => p.weekNumber))];

  // Fixtures for those teams/weeks, with scored lines + games and both sides.
  const fixtures = teamIds.length
    ? await prisma.fixture.findMany({
        where: {
          weekNumber: { in: weeks },
          OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
        },
        include: {
          lines: { include: { games: true } },
          homeTeam: { select: { id: true, club: true, market: true, divisionCode: true, color: true } },
          awayTeam: { select: { id: true, club: true, market: true, divisionCode: true, color: true } },
        },
      })
    : [];

  // Opponent pairings, indexed by team|week|rank, so we can name the opposing pair.
  const oppPairings = weeks.length
    ? await prisma.pairing.findMany({
        where: { weekNumber: { in: weeks } },
        include: {
          playerA: { select: { firstName: true, lastName: true } },
          playerB: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const oppIndex = new Map<string, (typeof oppPairings)[number]>();
  for (const op of oppPairings) oppIndex.set(`${op.teamId}|${op.weekNumber}|${op.rank}`, op);

  const matches: PlayerMatch[] = [];
  let linesPlayed = 0, linesWon = 0, linesLost = 0, gamesWon = 0, gamesLost = 0;

  for (const pr of pairings) {
    const fixture = fixtures.find(
      (f) => f.weekNumber === pr.weekNumber && (f.homeTeamId === pr.teamId || f.awayTeamId === pr.teamId)
    );
    if (!fixture) continue;
    const isHome = fixture.homeTeamId === pr.teamId;
    const opponent = isHome ? fixture.awayTeam : fixture.homeTeam;
    const opponentTeamId = isHome ? fixture.awayTeamId : fixture.homeTeamId;
    const line = fixture.lines.find((l) => l.lineNumber === pr.rank);
    const isExhibition = pr.rank === 4 || (line ? !line.isCounting : false);

    const partnerPerson = pr.playerAId === personId ? pr.playerB : pr.playerA;
    const partnerName = partnerPerson ? publicPlayerName(partnerPerson) : null;

    const opp = opponentTeamId ? oppIndex.get(`${opponentTeamId}|${fixture.weekNumber}|${pr.rank}`) : null;
    const opponentPair = opp ? `${publicPlayerName(opp.playerA)} / ${publicPlayerName(opp.playerB)}` : null;

    const games = (line?.games ?? [])
      .sort((a, b) => a.gameNumber - b.gameNumber)
      .map((g) => ({ playerScore: isHome ? g.homeScore : g.awayScore, opponentScore: isHome ? g.awayScore : g.homeScore }));

    let result: PlayerMatch["result"] = "pending";
    if (line?.lineWinner) result = line.lineWinner === (isHome ? "HOME" : "AWAY") ? "won" : "lost";

    // Record — counting lines only (exhibition shown but never tallied).
    if (line && fixture.status === "COMPLETED" && !isExhibition) {
      linesPlayed++;
      if (result === "won") linesWon++;
      else if (result === "lost") linesLost++;
      for (const g of games) {
        if (g.playerScore > g.opponentScore) gamesWon++;
        else if (g.playerScore < g.opponentScore) gamesLost++;
      }
    }

    matches.push({
      fixtureId: fixture.id,
      weekNumber: fixture.weekNumber,
      date: fixture.scheduledAt,
      status: fixture.status,
      lineNumber: pr.rank,
      isExhibition,
      opponentName: opponent ? teamShortName(opponent) : "TBD",
      opponentSlug: opponent ? idOf(opponent) : null,
      partnerName,
      opponentPair,
      games,
      result,
    });
  }

  matches.sort((a, b) => b.date.getTime() - a.date.getTime() || b.weekNumber - a.weekNumber);

  // Doubles position: most recent line, and the most-played line.
  const played = [...pairings].filter((p) => fixtures.some((f) => f.weekNumber === p.weekNumber && (f.homeTeamId === p.teamId || f.awayTeamId === p.teamId)));
  const currentLine = played.length ? played[played.length - 1].rank : null;
  const freq = new Map<number, number>();
  for (const p of played) freq.set(p.rank, (freq.get(p.rank) ?? 0) + 1);
  const commonLine = freq.size ? [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

  const coach = team.coach?.person ?? null;

  return {
    personId: person.id,
    slug: publicPlayerSlug(person, person.id),
    displayName: publicPlayerName(person),
    isMinor: person.isMinor,
    dupr: !person.isMinor && person.duprRating != null ? person.duprRating : null,
    teamName: teamDisplayName(team),
    teamShort: teamShortName(team),
    teamSlug: idOf(team),
    market: team.market,
    divisionCode: team.divisionCode,
    color: team.color,
    coachName: coach ? `${coach.firstName} ${coach.lastName}` : null,
    coachPersonId: coach?.id ?? null,
    currentLine,
    commonLine,
    linesPlayed,
    linesWon,
    linesLost,
    gamesWon,
    gamesLost,
    matches,
  };
}
