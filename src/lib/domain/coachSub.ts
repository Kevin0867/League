import "server-only";
import { prisma } from "@/lib/db";
import { dispatchMessage } from "@/lib/messaging";
import { ensureCoachCalendarToken } from "@/lib/domain/coachCalendar";
import { icsInvite, phoenixWallTimeToUtc, type IcsEvent } from "@/lib/domain/ics";
import { formatDate, formatTime12 } from "@/lib/time";

// Assign a coach to a single session as SUBSTITUTE (or another role) and notify
// them — shared by the admin "add a sub" action and a coach claiming an open sub
// request, so both paths behave identically:
//   • upsert the SessionCoach row (payable)
//   • a SUBSTITUTE works INSTEAD of the normal coach, so suppress the primary's
//     pay for this one session (pay follows whoever covered it)
//   • email/in-app the assigned coach the class link + an .ics invite + their
//     calendar-sync feed
export async function assignSessionSub(opts: {
  sessionId: string;
  coachId: string;
  role?: string;
  actorId?: string | null;
  origin: string;
}): Promise<{ ok: boolean }> {
  const role = opts.role?.trim() || "SUBSTITUTE";
  const { sessionId, coachId, origin } = opts;

  await prisma.sessionCoach.upsert({
    where: { sessionId_coachId: { sessionId, coachId } },
    create: { sessionId, coachId, role, payable: true },
    update: { role, payable: true },
  });

  if (role === "SUBSTITUTE") {
    await prisma.sessionCoach.updateMany({
      where: { sessionId, role: "PRIMARY", coachId: { not: coachId } },
      data: { payable: false },
    });
  }

  const assigned = await prisma.coach.findUnique({ where: { id: coachId }, select: { id: true, personId: true, person: { select: { email: true } } } });
  const sessDetail = await prisma.session.findUnique({ where: { id: sessionId }, include: { facility: true, teams: { include: { team: { select: { name: true } } } } } });
  if (!assigned?.personId || !sessDetail) return { ok: true };

  const feed = `${origin}/api/calendar/${await ensureCoachCalendarToken(assigned.id)}`;
  const teams = sessDetail.teams.map((t) => t.team.name).join(", ");
  const event: IcsEvent = {
    uid: `session-${sessDetail.id}@pureacademy`,
    start: phoenixWallTimeToUtc(sessDetail.date, sessDetail.startTime),
    end: phoenixWallTimeToUtc(sessDetail.date, sessDetail.endTime),
    summary: `${teams || "Session"} (${role.toLowerCase()})`,
    location: sessDetail.facility?.name ?? null,
    description: "PURE Academy",
  };
  const attachments = assigned.person?.email ? [icsInvite(teams || "PURE Academy session", [event], assigned.person.email)] : undefined;
  const classLink = `${origin}/console/schedule/${sessDetail.id}`;
  await dispatchMessage({
    senderId: opts.actorId ?? null, seasonId: sessDetail.seasonId,
    audienceType: "SINGLE_PERSON", audienceRef: assigned.personId,
    channels: ["IN_APP", "EMAIL"], triggerType: "COACH_ASSIGNED_SESSION",
    subject: "You've been added to a class",
    body: `You're set as ${role.toLowerCase()} for ${teams || "a session"} on ${formatDate(sessDetail.date)} at ${formatTime12(sessDetail.startTime)}${sessDetail.facility ? ` · ${sessDetail.facility.name}` : ""}. Open the class to check players in, add notes, and message the team: ${classLink}. You'll also get a text with this link about 15 minutes before it starts. The attached invite adds it to your calendar; subscribe to keep it in sync: ${feed}`,
    attachments,
  });
  return { ok: true };
}
