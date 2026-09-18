import "server-only";
import { prisma } from "@/lib/db";
import { phoenixDateInput } from "@/lib/time";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";

// Sessions a person is SUBBING for — a coach covering another team's class, or a
// player added as a one-date substitute. Surfaced on the coach's Today page and
// the player portal so a sub sees where to be, in next-practice order, with a
// one-tap directions link. They aren't on the team roster, so these never appear
// through the normal roster/teams paths.

export type SubSession = {
  sessionId: string;
  teamId: string | null;
  teamName: string;
  teamColor: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  facilityName: string | null;
  address: string | null;
  mapsUrl: string | null;
  /** For a coaching sub: PRIMARY | ASSISTANT | SUBSTITUTE | BACKUP. */
  role?: string;
};

function mapsUrl(name: string | null, address: string | null): string | null {
  const q = address || name;
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

const ACTIVE = ["SCHEDULED", "DELIVERED", "RESCHEDULED"];

/** Practices a coach is covering for a team they don't coach, next practice first. */
export async function coachSubSessions(coachId: string, ownTeamIds: string[]): Promise<SubSession[]> {
  const today = phoenixDateInput(new Date());
  const from = new Date(Date.now() - 1 * 86400000);
  const sessions = await prisma.session.findMany({
    where: {
      coaches: { some: { coachId } },
      teams: { none: { teamId: { in: ownTeamIds } } },
      type: "PRACTICE",
      status: { in: ACTIVE },
      date: { gte: from },
    },
    include: {
      facility: { select: { name: true, exactAddress: true, generalArea: true } },
      teams: { include: { team: { select: { id: true, name: true, color: true } } } },
      coaches: { where: { coachId }, select: { role: true } },
    },
    orderBy: { date: "asc" },
  });
  return sessions
    .filter((s) => phoenixDateInput(s.date) >= today)
    .map((s) => {
      const team = s.teams[0]?.team ?? null;
      const address = s.facility?.exactAddress || s.facility?.generalArea || null;
      return {
        sessionId: s.id,
        teamId: team?.id ?? null,
        teamName: team?.name ?? "A team",
        teamColor: team?.color ?? null,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        facilityName: s.facility?.name ?? null,
        address,
        mapsUrl: mapsUrl(s.facility?.name ?? null, address),
        role: s.coaches[0]?.role,
      };
    })
    .sort((a, b) => phoenixWallTimeToUtc(a.date, a.startTime).getTime() - phoenixWallTimeToUtc(b.date, b.startTime).getTime());
}

/** Dates a player (or their household) is subbing in for, next practice first. */
export async function playerSubSessions(personIds: string[]): Promise<SubSession[]> {
  if (personIds.length === 0) return [];
  const today = phoenixDateInput(new Date());
  const from = new Date(Date.now() - 1 * 86400000);
  const subs = await prisma.sessionSub.findMany({ where: { personId: { in: personIds } }, select: { sessionId: true, teamId: true } });
  if (subs.length === 0) return [];
  const sessionIds = [...new Set(subs.map((s) => s.sessionId))];
  const teamIds = [...new Set(subs.map((s) => s.teamId))];
  const [sessions, teams] = await Promise.all([
    prisma.session.findMany({
      where: { id: { in: sessionIds }, status: { in: ACTIVE }, date: { gte: from } },
      include: { facility: { select: { name: true, exactAddress: true, generalArea: true } } },
    }),
    prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, color: true } }),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamForSession = new Map(subs.map((s) => [s.sessionId, s.teamId]));
  return sessions
    .filter((s) => phoenixDateInput(s.date) >= today)
    .map((s) => {
      const team = teamById.get(teamForSession.get(s.id) ?? "") ?? null;
      const address = s.facility?.exactAddress || s.facility?.generalArea || null;
      return {
        sessionId: s.id,
        teamId: team?.id ?? null,
        teamName: team?.name ?? "A team",
        teamColor: team?.color ?? null,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        facilityName: s.facility?.name ?? null,
        address,
        mapsUrl: mapsUrl(s.facility?.name ?? null, address),
      };
    })
    .sort((a, b) => phoenixWallTimeToUtc(a.date, a.startTime).getTime() - phoenixWallTimeToUtc(b.date, b.startTime).getTime());
}
