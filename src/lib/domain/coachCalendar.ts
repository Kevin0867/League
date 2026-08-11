import crypto from "crypto";
import { prisma } from "@/lib/db";
import { buildIcs, phoenixWallTimeToUtc, type IcsEvent } from "./ics";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice",
  LEAGUE_MATCH: "League match",
  CHAMPIONSHIP: "Championship",
  ALA_CARTE: "Lesson",
};

/** Lazily mint the coach's secret calendar-feed token (stable once created). */
export async function ensureCoachCalendarToken(coachId: string): Promise<string> {
  const c = await prisma.coach.findUnique({ where: { id: coachId }, select: { calendarToken: true } });
  if (c?.calendarToken) return c.calendarToken;
  const token = crypto.randomBytes(24).toString("hex");
  await prisma.coach.update({ where: { id: coachId }, data: { calendarToken: token } });
  return token;
}

/**
 * Every calendar event for a coach: their sessions (practices, league matches,
 * championships) plus à-la-carte lessons and clinics they teach. Used by the
 * subscription feed so a coach's phone stays in sync as the schedule changes.
 */
export async function coachCalendarEvents(coachId: string): Promise<{ name: string; events: IcsEvent[] }> {
  const [coach, sessions, offerings, bookings, facilities] = await Promise.all([
    prisma.coach.findUnique({ where: { id: coachId }, include: { person: true } }),
    prisma.session.findMany({
      where: { coaches: { some: { coachId } } },
      include: { facility: true, teams: { include: { team: { select: { name: true } } } } },
      orderBy: { date: "asc" },
    }),
    prisma.alaCarteOffering.findMany({
      where: { coachId, scheduledAt: { not: null } },
      include: { facility: true },
    }),
    prisma.alaCarteBooking.findMany({
      where: { coachId, scheduledAt: { not: null }, status: { notIn: ["CANCELLED", "DECLINED"] } },
      include: { offering: { include: { facility: true } }, client: { select: { firstName: true, lastName: true } } },
    }),
    prisma.facility.findMany({ select: { id: true, name: true } }),
  ]);

  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  const events: IcsEvent[] = [];

  for (const s of sessions) {
    const teams = s.teams.map((t) => t.team.name).join(", ");
    const label = TYPE_LABEL[s.type] ?? "Session";
    const where = s.relocatedFacilityId ? facilityName.get(s.relocatedFacilityId) ?? s.facility?.name : s.facility?.name;
    events.push({
      uid: `session-${s.id}@pureacademy`,
      start: phoenixWallTimeToUtc(s.date, s.startTime),
      end: phoenixWallTimeToUtc(s.date, s.endTime),
      summary: teams ? `${label} · ${teams}` : label,
      location: where ?? null,
      description: "PURE Academy",
      cancelled: s.status === "CANCELLED",
    });
  }

  for (const o of offerings) {
    if (!o.scheduledAt) continue;
    const end = new Date(o.scheduledAt.getTime() + 90 * 60000);
    events.push({
      uid: `offering-${o.id}@pureacademy`,
      start: o.scheduledAt,
      end,
      summary: `${o.type === "CLINIC" ? "Clinic" : o.type === "SEMI_PRIVATE" ? "Semi-private" : "Private lesson"} · ${o.title}`,
      location: o.facility?.name ?? null,
      description: o.description ?? "PURE Academy lesson",
      cancelled: !o.active,
    });
  }

  for (const bk of bookings) {
    if (!bk.scheduledAt) continue;
    const end = new Date(bk.scheduledAt.getTime() + 60 * 60000);
    const client = `${bk.client.firstName} ${bk.client.lastName}`.trim();
    events.push({
      uid: `booking-${bk.id}@pureacademy`,
      start: bk.scheduledAt,
      end,
      summary: `Private lesson · ${client}`,
      location: bk.offering?.facility?.name ?? null,
      description: "PURE Academy lesson",
      cancelled: bk.status === "CANCELLED",
    });
  }

  const name = coach?.person ? `${coach.person.firstName} ${coach.person.lastName} — PURE Academy` : "PURE Academy — Coach";
  return { name, events };
}

/** The full ICS document for a coach's feed. */
export async function coachCalendarIcs(coachId: string): Promise<string> {
  const { name, events } = await coachCalendarEvents(coachId);
  return buildIcs(name, events);
}
