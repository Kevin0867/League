import crypto from "crypto";
import { prisma } from "@/lib/db";
import { buildIcs, phoenixWallTimeToUtc, type IcsEvent } from "./ics";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice",
  LEAGUE_MATCH: "League match",
  CHAMPIONSHIP: "Championship",
};

/** Lazily mint a household's secret calendar-feed token (stable once created). */
export async function ensureFamilyCalendarToken(personId: string): Promise<string> {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { calendarToken: true } });
  if (p?.calendarToken) return p.calendarToken;
  const token = crypto.randomBytes(24).toString("hex");
  await prisma.person.update({ where: { id: personId }, data: { calendarToken: token } });
  return token;
}

/** Practices & matches for every team the household's player(s) are on. */
export async function familyCalendarEvents(personId: string): Promise<{ name: string; events: IcsEvent[] }> {
  const me = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, firstName: true, dependents: { select: { id: true, firstName: true } } },
  });
  if (!me) return { name: "PURE Academy", events: [] };

  const people = [{ id: me.id, firstName: me.firstName }, ...me.dependents];
  const peopleIds = people.map((p) => p.id);
  const firstNameById = new Map(people.map((p) => [p.id, p.firstName]));

  const memberships = await prisma.teamMember.findMany({
    where: { personId: { in: peopleIds }, roleOnTeam: "PLAYER" },
    select: { personId: true, teamId: true },
  });
  if (!memberships.length) return { name: `${me.firstName} — PURE Academy`, events: [] };

  const teamIds = [...new Set(memberships.map((m) => m.teamId))];
  // Which household players are on each team (to label multi-child families).
  const playersByTeam = new Map<string, string[]>();
  for (const m of memberships) {
    const arr = playersByTeam.get(m.teamId) ?? [];
    const n = firstNameById.get(m.personId);
    if (n) arr.push(n);
    playersByTeam.set(m.teamId, arr);
  }

  const [sessions, facilities] = await Promise.all([
    prisma.session.findMany({
      where: { teams: { some: { teamId: { in: teamIds } } } },
      include: { facility: true, teams: { include: { team: { select: { id: true, name: true } } } } },
      orderBy: { date: "asc" },
    }),
    prisma.facility.findMany({ select: { id: true, name: true } }),
  ]);
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  const multiPlayer = people.length > 1;

  const events: IcsEvent[] = [];
  for (const s of sessions) {
    const ourTeams = s.teams.filter((t) => teamIds.includes(t.team.id));
    if (!ourTeams.length) continue;
    const teamNames = ourTeams.map((t) => t.team.name).join(", ");
    const label = TYPE_LABEL[s.type] ?? "Session";
    const kids = [...new Set(ourTeams.flatMap((t) => playersByTeam.get(t.team.id) ?? []))].filter(Boolean);
    const who = multiPlayer && kids.length ? ` (${kids.join(", ")})` : "";
    const where = s.relocatedFacilityId ? facilityName.get(s.relocatedFacilityId) ?? s.facility?.name : s.facility?.name;
    events.push({
      uid: `fam-${s.id}-${personId}@pureacademy`,
      start: phoenixWallTimeToUtc(s.date, s.startTime),
      end: phoenixWallTimeToUtc(s.date, s.endTime),
      summary: teamNames ? `${label} · ${teamNames}${who}` : `${label}${who}`,
      location: where ?? null,
      description: "PURE Academy",
      cancelled: s.status === "CANCELLED",
    });
  }

  return { name: `${me.firstName} — PURE Academy`, events };
}

export async function familyCalendarIcs(personId: string): Promise<string> {
  const { name, events } = await familyCalendarEvents(personId);
  return buildIcs(name, events);
}
