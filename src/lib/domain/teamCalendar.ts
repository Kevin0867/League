import "server-only";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/stripe";
import { dispatchMessage } from "@/lib/messaging";
import { formatSessionDay, formatTime12 } from "@/lib/time";

// Team calendar + substitute workflow. A player marks they'll miss a practice,
// which opens a "we need a sub" spot for that team & date and notifies the team,
// coach, and admins; anyone can suggest a sub; a coach adds one for that date,
// clearing a spot.

export type CalendarSession = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  type: string;
  status: string;
  title: string;
  facilityName: string | null;
  address: string | null;
  absentCount: number;
  subCount: number;
  openSpots: number;
  iAmOut: boolean;
  myAbsenceId: string | null;
};

/** A friendly one-line description of a team: division + day/time, e.g.
 *  "Women's Elite 3.5 · Tuesdays at 5:00 PM". */
export function teamDescription(team: { name: string; division?: { name: string | null } | null; levelBand?: string | null; dayOfWeek?: string | null; startTime?: string | null }): string {
  const div = team.division?.name || team.levelBand || team.name;
  const when = team.dayOfWeek ? `${team.dayOfWeek}s${team.startTime ? ` at ${formatTime12(team.startTime)}` : ""}` : null;
  return [div, when].filter(Boolean).join(" · ");
}

/** All of a team's calendar sessions (practices, league matches, etc.), newest
 *  first is NOT what we want here — ordered by date ascending — with per-session
 *  absence/sub counts and whether the given household is marked out. */
export async function listTeamCalendar(teamId: string, householdIds: string[]): Promise<CalendarSession[]> {
  const sessions = await prisma.session.findMany({
    where: { teams: { some: { teamId } }, status: { not: "CANCELLED" } },
    orderBy: { date: "asc" },
    include: { facility: { select: { name: true, exactAddress: true, generalArea: true } } },
  });
  const ids = sessions.map((s) => s.id);
  const [absences, subs] = await Promise.all([
    ids.length ? prisma.playerAbsence.findMany({ where: { sessionId: { in: ids } }, select: { id: true, sessionId: true, personId: true } }) : Promise.resolve([]),
    ids.length ? prisma.sessionSub.findMany({ where: { sessionId: { in: ids } }, select: { sessionId: true } }) : Promise.resolve([]),
  ]);
  const absBySession = new Map<string, { id: string; personId: string }[]>();
  for (const a of absences) { const arr = absBySession.get(a.sessionId) ?? []; arr.push({ id: a.id, personId: a.personId }); absBySession.set(a.sessionId, arr); }
  const subCountBySession = new Map<string, number>();
  for (const s of subs) subCountBySession.set(s.sessionId, (subCountBySession.get(s.sessionId) ?? 0) + 1);

  const TITLES: Record<string, string> = { PRACTICE: "Practice", LEAGUE_MATCH: "League match", CHAMPIONSHIP: "Championship", ALA_CARTE: "Session" };
  return sessions.map((s) => {
    const abs = absBySession.get(s.id) ?? [];
    const subCount = subCountBySession.get(s.id) ?? 0;
    const mine = abs.find((a) => householdIds.includes(a.personId));
    return {
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      type: s.type,
      status: s.status,
      title: TITLES[s.type] ?? "Session",
      facilityName: s.facility?.name ?? null,
      address: s.facility?.exactAddress || s.facility?.generalArea || null,
      absentCount: abs.length,
      subCount,
      openSpots: Math.max(0, abs.length - subCount),
      iAmOut: !!mine,
      myAbsenceId: mine?.id ?? null,
    };
  });
}

// Per-practice availability, so the coach, teammates, and admins can see at a
// glance who's in, who's out (sub needed), and who hasn't responded yet.
export type RosterStatusKind = "in" | "out" | "pending";
export type RosterMember = { personId: string; name: string; status: RosterStatusKind; isSub: boolean };

const STATUS_ORDER: Record<RosterStatusKind, number> = { out: 0, pending: 1, in: 2 };

/**
 * The roster availability for each of the given sessions:
 *   • out     — the player marked themselves out (a sub is needed), or a coach
 *               recorded them absent/excused.
 *   • in      — checked in / marked present.
 *   • pending — on the roster but hasn't checked in or marked out yet.
 * Added substitutes are included too, tagged isSub. Sorted out → pending → in,
 * then by name, so "who's out" reads first.
 */
export async function teamRosterStatus(teamId: string, sessionIds: string[]): Promise<Map<string, RosterMember[]>> {
  const map = new Map<string, RosterMember[]>();
  if (sessionIds.length === 0) return map;

  const [members, absences, attendance, subs] = await Promise.all([
    prisma.teamMember.findMany({ where: { teamId }, select: { person: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.playerAbsence.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, personId: true } }),
    prisma.attendance.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, personId: true, status: true } }),
    prisma.sessionSub.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, personId: true } }),
  ]);

  // Names for subs (SessionSub carries no person relation).
  const subPersonIds = [...new Set(subs.map((s) => s.personId))];
  const subPeople = subPersonIds.length
    ? await prisma.person.findMany({ where: { id: { in: subPersonIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameById = new Map<string, string>();
  for (const m of members) nameById.set(m.person.id, `${m.person.firstName} ${m.person.lastName}`.trim());
  for (const p of subPeople) nameById.set(p.id, `${p.firstName} ${p.lastName}`.trim());

  const absentKey = new Set(absences.map((a) => `${a.sessionId}:${a.personId}`));
  const attByKey = new Map(attendance.map((a) => [`${a.sessionId}:${a.personId}`, a.status]));
  const subsBySession = new Map<string, string[]>();
  for (const s of subs) { const arr = subsBySession.get(s.sessionId) ?? []; arr.push(s.personId); subsBySession.set(s.sessionId, arr); }

  const statusFor = (sessionId: string, personId: string): RosterStatusKind => {
    const att = attByKey.get(`${sessionId}:${personId}`);
    if (att === "PRESENT") return "in";
    if (absentKey.has(`${sessionId}:${personId}`) || att === "ABSENT" || att === "EXCUSED") return "out";
    return "pending";
  };

  for (const sessionId of sessionIds) {
    const rows: RosterMember[] = members.map((m) => ({
      personId: m.person.id,
      name: nameById.get(m.person.id) ?? "Player",
      status: statusFor(sessionId, m.person.id),
      isSub: false,
    }));
    for (const pid of subsBySession.get(sessionId) ?? []) {
      rows.push({ personId: pid, name: nameById.get(pid) ?? "Sub", status: statusFor(sessionId, pid), isSub: true });
    }
    rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
    map.set(sessionId, rows);
  }
  return map;
}

export type TeamEventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  createdByPersonId: string | null;
  createdByName: string | null;
  createdByRole: string;
};

/** A team's user-added events (dinners, extra hits, socials), date ascending. */
export async function listTeamEvents(teamId: string): Promise<TeamEventItem[]> {
  return prisma.teamEvent.findMany({ where: { teamId }, orderBy: [{ date: "asc" }, { startTime: "asc" }] });
}

/** Notify the team + coach that a member/coach/admin added a calendar event. */
export async function notifyEventAdded(teamId: string, ev: TeamEventItem): Promise<void> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  if (!team) return;
  const when = `${formatSessionDay(ev.date, "long")}${ev.startTime ? ` at ${formatTime12(ev.startTime)}` : ""}`;
  const where = ev.location ? ` · ${ev.location}` : "";
  const roleLabel = ev.createdByRole === "COACH" ? "your coach" : ev.createdByRole === "ADMIN" ? "the office" : "a teammate";
  const who = ev.createdByName ? `${ev.createdByName} (${roleLabel})` : roleLabel;
  const link = `${appUrl()}/portal/team/${teamId}/calendar`;
  const subject = `New team event — ${team.name}: ${ev.title}`;
  const body = `${who} added a team event to ${team.name}'s calendar: "${ev.title}" — ${when}${where}.${ev.description ? ` ${ev.description}` : ""} See the team calendar: ${link}`;
  try {
    await dispatchMessage({ senderId: ev.createdByPersonId, audienceType: "TEAM", audienceRef: teamId, channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "TEAM_EVENT", subject, body });
  } catch (e) {
    console.error("notifyEventAdded failed", e);
  }
}

/** Open spots (absences not yet covered by a sub) for one session. */
export async function openSpotsFor(sessionId: string): Promise<number> {
  const [abs, subs] = await Promise.all([
    prisma.playerAbsence.count({ where: { sessionId } }),
    prisma.sessionSub.count({ where: { sessionId } }),
  ]);
  return Math.max(0, abs - subs);
}

async function sessionContext(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      facility: { select: { name: true, exactAddress: true, generalArea: true } },
      teams: { include: { team: { include: { division: { select: { name: true } }, coach: { select: { personId: true } } } } } },
    },
  });
  if (!session) return null;
  const team = session.teams[0]?.team ?? null;
  return { session, team };
}

/** Notify the team + coach + admins that a sub is needed for this session. */
export async function notifySubNeeded(sessionId: string, teamId: string): Promise<void> {
  const open = await openSpotsFor(sessionId);
  if (open <= 0) return;
  const ctx = await sessionContext(sessionId);
  if (!ctx?.team) return;
  const { session, team } = ctx;
  const when = `${formatSessionDay(session.date, "long")} at ${formatTime12(session.startTime)}`;
  const loc = session.facility?.name ? ` at ${session.facility.name}` : "";
  const desc = teamDescription(team);
  const link = `${appUrl()}/portal/team/${teamId}/calendar`;
  const spots = open === 1 ? "1 spot" : `${open} spots`;
  const body = open === 1
    ? `PLAYER SUB NEEDED for ${team.name} (${desc}) — ${when}${loc}. A player can't make it, so we have 1 open spot. Know a sub? Suggest one in the team calendar: ${link}`
    : `PLAYER SUB NEEDED — we now have ${spots} open for ${team.name} (${desc}) — ${when}${loc}. Know someone who can sub? Suggest a sub in the team calendar: ${link}`;
  const subject = `Player sub needed — ${team.name}`;
  try {
    await dispatchMessage({ senderId: null, audienceType: "TEAM", audienceRef: teamId, channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "SUB_REQUEST", subject, body });
    await dispatchMessage({ senderId: null, audienceType: "ALL_ADMINS", channels: ["IN_APP", "EMAIL"], triggerType: "SUB_REQUEST", subject, body });
  } catch (e) {
    console.error("notifySubNeeded failed", e);
  }
}

/** Notify the coach + admins that someone suggested a sub. */
export async function notifySubSuggested(sessionId: string, teamId: string, sub: { name: string; email: string | null; phone: string | null }, byName: string): Promise<void> {
  const ctx = await sessionContext(sessionId);
  if (!ctx?.team) return;
  const { session, team } = ctx;
  const when = `${formatSessionDay(session.date, "long")} at ${formatTime12(session.startTime)}`;
  const link = `${appUrl()}/console/schedule/${sessionId}`;
  const contact = [sub.email, sub.phone].filter(Boolean).join(", ");
  const body = `${byName} suggested a substitute for ${team.name} — ${when}: ${sub.name}${contact ? ` (${contact})` : ""}. Review and add them for that date: ${link}`;
  const subject = `Sub suggested — ${team.name}`;
  try {
    if (team.coach?.personId) {
      await dispatchMessage({ senderId: null, audienceType: "SINGLE_PERSON", audienceRef: team.coach.personId, channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "SUB_OFFER", subject, body });
    }
    await dispatchMessage({ senderId: null, audienceType: "ALL_ADMINS", channels: ["IN_APP", "EMAIL"], triggerType: "SUB_OFFER", subject, body });
  } catch (e) {
    console.error("notifySubSuggested failed", e);
  }
}
