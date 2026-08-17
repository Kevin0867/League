import { NextResponse } from "next/server";
import { formatDate, formatTime12 } from "@/lib/time";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { generatePracticeDates, cancellationOutcome } from "@/lib/domain/schedule";
import { ensureCoachCalendarToken } from "@/lib/domain/coachCalendar";
import { icsInvite, phoenixWallTimeToUtc, type IcsEvent } from "@/lib/domain/ics";
import { coachSessionConflicts } from "@/lib/domain/coachSchedule";
import { isBookable, DOW } from "@/lib/domain/facilityWindows";

// Schedule mutations as native-form-POST route handlers with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

const PRACTICE_WEEKS = 6;
const DEFAULT_DURATION_MIN = 90;
const DEFAULT_COURTS = 2;

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();

  // Where to bounce back to. Detail-page forms pass their own path; anything
  // else falls back to the schedule index.
  const rawReturn = String(formData.get("returnTo") ?? "");
  const returnTo = rawReturn.startsWith("/console/schedule") ? rawReturn : "/console/schedule";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  // Reschedule a single session — date, time, and/or facility (§7). Notifies the
  // team(s) by default so families see the change (opt out with the checkbox).
  if (op === "editSession") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    if (!sessionId) return back("?err=notfound");
    const dateStr = String(formData.get("date") ?? "").trim();
    const startTime = String(formData.get("startTime") ?? "").trim();
    const endTime = String(formData.get("endTime") ?? "").trim();
    const facilityId = String(formData.get("facilityId") ?? "").trim() || null;
    const notify = String(formData.get("notify") ?? "") === "1";
    const parsedDate = dateStr ? new Date(dateStr) : null;
    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: {
        ...(parsedDate && !isNaN(parsedDate.getTime()) ? { date: parsedDate } : {}),
        ...(startTime ? { startTime } : {}),
        ...(endTime ? { endTime } : {}),
        facilityId,
      },
      include: { teams: true, facility: true },
    });

    if (notify) {
      const kind = updated.type === "PRACTICE" ? "practice" : updated.type === "LEAGUE_MATCH" ? "league match" : "session";
      const body = `Your ${kind} has been rescheduled to ${formatDate(updated.date)} at ${formatTime12(updated.startTime)}${updated.facility ? ` · ${updated.facility.name}` : ""}. Check your portal for details.`;
      for (const st of updated.teams) {
        await dispatchMessage({
          senderId: actor.userId, seasonId: updated.seasonId,
          audienceType: "TEAM", audienceRef: st.teamId,
          channels: ["IN_APP", "EMAIL"], triggerType: "SESSION_RESCHEDULED",
          subject: `${kind[0].toUpperCase()}${kind.slice(1)} rescheduled`, body,
        });
      }
    }

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.edit", summary: `Rescheduled session${notify ? " + notified team" : ""}` });
    return back("?ok=edited");
  }

  // generateSchedule — manageScheduling (§7)
  if (op === "generate") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

    const teamId = String(formData.get("teamId") ?? "");
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { season: true, facility: true },
    });
    if (!team) return back("?err=team");
    if (!team.dayOfWeek || !team.startTime || !team.facilityId) return back("?err=config");

    // Idempotent: don't double-generate practices.
    const existing = await prisma.session.count({
      where: { type: "PRACTICE", teams: { some: { teamId } } },
    });
    if (existing > 0) return back("?err=exists");

    const blackouts = (
      await prisma.blackoutDate.findMany({
        where: { OR: [{ facilityId: null }, { facilityId: team.facilityId }] },
      })
    ).map((b) => b.date);

    const dates = generatePracticeDates(team.season.startDate, team.dayOfWeek, PRACTICE_WEEKS, blackouts);
    const endTime = addMinutes(team.startTime, DEFAULT_DURATION_MIN);

    const created: { id: string; date: Date }[] = [];
    for (let i = 0; i < dates.length; i++) {
      const s = await prisma.session.create({
        data: {
          seasonId: team.seasonId,
          type: "PRACTICE",
          facilityId: team.facilityId,
          date: dates[i],
          startTime: team.startTime,
          endTime,
          courtCount: DEFAULT_COURTS,
          status: "SCHEDULED",
          weekNumber: i + 1,
          teams: { create: { teamId } },
          ...(team.coachId ? { coaches: { create: { coachId: team.coachId, role: "PRIMARY" } } } : {}),
        },
      });
      created.push({ id: s.id, date: dates[i] });
    }

    // Tell the head coach their practices are set: the calendar-sync link plus an
    // emailed .ics invite for all the practices so they land in their calendar.
    if (team.coachId) {
      const c = await prisma.coach.findUnique({ where: { id: team.coachId }, select: { id: true, personId: true, person: { select: { email: true } } } });
      if (c?.personId) {
        const feed = `${origin}/api/calendar/${await ensureCoachCalendarToken(c.id)}`;
        const events: IcsEvent[] = created.map((s) => ({
          uid: `session-${s.id}@pureacademy`,
          start: phoenixWallTimeToUtc(s.date, team.startTime!),
          end: phoenixWallTimeToUtc(s.date, endTime),
          summary: `Practice · ${team.name}`,
          location: team.facility?.name ?? null,
          description: "PURE Academy practice",
        }));
        const attachments = c.person?.email && events.length ? [icsInvite(`${team.name} practices`, events, c.person.email)] : undefined;
        await dispatchMessage({
          senderId: actor.userId, seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON", audienceRef: c.personId,
          channels: ["IN_APP", "EMAIL"], triggerType: "COACH_SCHEDULE_SET",
          subject: `Your ${team.name} practices are scheduled`,
          body: `${created.length} practices are set for ${team.name}. The invite attached adds them to your calendar, or subscribe so it always stays in sync: ${feed}`,
          attachments,
        });
      }
    }

    await audit({
      actorId: actor.userId,
      entityType: "Team",
      entityId: teamId,
      action: "GENERATE_SCHEDULE",
      summary: `Generated ${created.length} practice sessions`,
    });

    return back("?ok=generate");
  }

  // cancelSession — manageScheduling (§7, §13)
  if (op === "cancel") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

    const sessionId = String(formData.get("sessionId") ?? "");
    const reason = String(formData.get("reason") ?? "OTHER");

    const s = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { teams: { include: { team: true } } },
    });
    if (!s) return back("?err=session");

    const outcome = cancellationOutcome(s.type);
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: outcome.newStatus, cancelReason: reason },
    });

    // Practice cancellations are time-critical → include SMS (§13).
    const isPractice = s.type === "PRACTICE";
    const reasonLabel = reason.toLowerCase().replace(/_/g, " ");
    for (const st of s.teams) {
      await dispatchMessage({
        senderId: actor.userId,
        seasonId: s.seasonId,
        audienceType: "TEAM",
        audienceRef: st.teamId,
        channels: isPractice ? ["IN_APP", "EMAIL", "SMS"] : ["IN_APP", "EMAIL"],
        triggerType: isPractice ? "PRACTICE_CANCELLED" : "SESSION_RESCHEDULED",
        subject: isPractice ? `Practice cancelled (${reasonLabel})` : `Match to be rescheduled (${reasonLabel})`,
        body: isPractice
          ? `Your ${st.team.name} practice on ${formatDate(s.date)} is cancelled (${reasonLabel}). There is no make-up — your place on the team is unchanged.`
          : `Your ${st.team.name} fixture on ${formatDate(s.date)} will be rescheduled within 14 days (${reasonLabel}). Details to follow.`,
      });
    }

    await audit({
      actorId: actor.userId,
      entityType: "Session",
      entityId: sessionId,
      action: "CANCEL",
      summary: `${s.type} → ${outcome.newStatus} (${reason}). ${outcome.note}`,
    });

    return back("?ok=cancel");
  }

  // Hard-delete a single session — for one created by mistake. Quiet: no team
  // notification (use Cancel for that). Join rows (teams, coaches, attendance)
  // cascade away.
  if (op === "deleteSession") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, type: true, date: true } });
    if (!s) return back("?err=session");
    try {
      await prisma.session.delete({ where: { id: sessionId } });
    } catch {
      return back("?err=sessionlinked");
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "DELETE", summary: `Deleted ${s.type} on ${formatDate(s.date)}` });
    return back("?ok=deleted");
  }

  // Clear a team's practices so they can be regenerated (e.g. after fixing the
  // team's day/time/facility). Deletes only PRACTICE sessions for that team.
  if (op === "clearPractices") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const teamId = String(formData.get("teamId") ?? "");
    if (!teamId) return back("?err=team");
    const sessions = await prisma.session.findMany({
      where: { type: "PRACTICE", teams: { some: { teamId } } },
      select: { id: true },
    });
    const ids = sessions.map((x) => x.id);
    if (ids.length) {
      try {
        await prisma.session.deleteMany({ where: { id: { in: ids } } });
      } catch {
        return back("?err=sessionlinked");
      }
    }
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "CLEAR_PRACTICES", summary: `Cleared ${ids.length} practice(s)` });
    return back(`?ok=cleared&n=${ids.length}`);
  }

  // relocateSession — manageScheduling (§7). Notifies the team(s) of the new venue.
  if (op === "relocate") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

    const sessionId = String(formData.get("sessionId") ?? "");
    const facilityId = String(formData.get("facilityId") ?? "");
    const notify = String(formData.get("notify") ?? "") === "1";
    if (!facilityId) return back("?err=facility");

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { relocatedFacilityId: facilityId, status: "SCHEDULED", cancelReason: null },
      include: { teams: true },
    });
    const fac = await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } });

    if (notify) {
      const body = `Your session on ${formatDate(updated.date)} at ${formatTime12(updated.startTime)} has been moved to ${fac?.name ?? "a new location"}. Check your portal for details.`;
      for (const st of updated.teams) {
        await dispatchMessage({
          senderId: actor.userId, seasonId: updated.seasonId,
          audienceType: "TEAM", audienceRef: st.teamId,
          channels: ["IN_APP", "EMAIL"], triggerType: "SESSION_RELOCATED",
          subject: "Session moved to a new location", body,
        });
      }
    }

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "RELOCATE", summary: `Relocated to ${fac?.name ?? facilityId}${notify ? " + notified team" : ""}` });
    return back("?ok=relocate");
  }

  // Add a single one-off practice for a team and (by default) notify the team.
  // Complements bulk "generate" — for a make-up session or an extra practice.
  if (op === "addSession") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const teamId = String(formData.get("teamId") ?? "");
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return back("?err=team");

    const dateStr = String(formData.get("date") ?? "").trim();
    const parsed = dateStr ? new Date(dateStr) : null;
    if (!parsed || isNaN(parsed.getTime())) return back("?err=adddate");
    const startTime = String(formData.get("startTime") ?? "").trim() || team.startTime || "17:00";
    const endTime = String(formData.get("endTime") ?? "").trim() || addMinutes(startTime, DEFAULT_DURATION_MIN);
    const facilityId = String(formData.get("facilityId") ?? "").trim() || team.facilityId || null;
    const notify = String(formData.get("notify") ?? "") === "1";

    // If the chosen facility publishes availability windows, the practice's
    // weekday + start time must land inside one — you can't book a court when
    // it isn't open. Facilities with no windows are unconstrained.
    if (facilityId) {
      const blocks = await prisma.courtBlock.findMany({ where: { facilityId } });
      if (blocks.length) {
        const dow = DOW[parsed.getUTCDay()];
        if (!isBookable(blocks, dow, startTime).ok) return back("?err=addslot");
      }
    }

    const created = await prisma.session.create({
      data: {
        seasonId: team.seasonId,
        type: "PRACTICE",
        facilityId,
        date: parsed,
        startTime,
        endTime,
        courtCount: DEFAULT_COURTS,
        status: "SCHEDULED",
        teams: { create: { teamId } },
        ...(team.coachId ? { coaches: { create: { coachId: team.coachId, role: "PRIMARY" } } } : {}),
      },
    });

    if (notify) {
      const fac = facilityId ? await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }) : null;
      await dispatchMessage({
        senderId: actor.userId, seasonId: team.seasonId,
        audienceType: "TEAM", audienceRef: teamId,
        channels: ["IN_APP", "EMAIL"], triggerType: "SESSION_ADDED",
        subject: "New practice added",
        body: `A new practice has been added for ${team.name}: ${formatDate(parsed)} at ${formatTime12(startTime)}${fac ? ` · ${fac.name}` : ""}. Check your portal for details.`,
      });
    }

    await audit({ actorId: actor.userId, entityType: "Session", entityId: created.id, action: "session.add", summary: `Added a practice for ${team.name}${notify ? " + notified team" : ""}` });
    return back("?ok=added");
  }

  // markAttendance — markAttendance, allowed for COACH too (§7)
  if (op === "attendance") {
    if (!actor || !can(actor.role, "markAttendance")) return back("?err=auth");

    const sessionId = String(formData.get("sessionId") ?? "");
    const s = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { teams: { include: { team: { include: { members: true } } } } },
    });
    if (!s) return back("?err=session");

    const personIds = s.teams.flatMap((t) => t.team.members.map((m) => m.personId));
    for (const personId of personIds) {
      const status = String(formData.get(`att_${personId}`) ?? "PRESENT");
      await prisma.attendance.upsert({
        where: { sessionId_personId: { sessionId, personId } },
        create: { sessionId, personId, status },
        update: { status },
      });
    }

    // Marking attendance confirms the session happened.
    if (s.status === "SCHEDULED") {
      await prisma.session.update({ where: { id: sessionId }, data: { status: "DELIVERED" } });
    }

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "ATTENDANCE", summary: `Marked attendance for ${personIds.length} player(s)` });

    return back("?ok=attendance");
  }

  // Add a substitute/backup coach for this single class. A coach may sub as long
  // as it doesn't overlap another session they cover that day.
  if (op === "assignSubstitute") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    const coachId = String(formData.get("coachId") ?? "").trim();
    const role = String(formData.get("role") ?? "SUBSTITUTE").trim() || "SUBSTITUTE";
    const force = String(formData.get("force") ?? "") === "1";
    if (!sessionId || !coachId) return back("?err=session");

    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { date: true, startTime: true, endTime: true } });
    if (!session) return back("?err=session");
    const coach = await prisma.coach.findUnique({ where: { id: coachId } });
    if (!coach) return back("?err=coachgate");
    // Clearance is a warning, not a block — the admin may assign an uncleared
    // coach (e.g. a last-minute sub) and decide for themselves.

    if (!force) {
      const clashes = await coachSessionConflicts({ coachId, date: session.date, startTime: session.startTime, endTime: session.endTime, excludeSessionId: sessionId });
      if (clashes.length) return back("?err=subclash");
    }
    await prisma.sessionCoach.upsert({
      where: { sessionId_coachId: { sessionId, coachId } },
      create: { sessionId, coachId, role },
      update: { role },
    });

    // Notify the assigned coach, with an emailed .ics invite for this class plus
    // their calendar-sync link.
    const assigned = await prisma.coach.findUnique({ where: { id: coachId }, select: { id: true, personId: true, person: { select: { email: true } } } });
    const sessDetail = await prisma.session.findUnique({ where: { id: sessionId }, include: { facility: true, teams: { include: { team: { select: { name: true } } } } } });
    if (assigned?.personId && sessDetail) {
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
      await dispatchMessage({
        senderId: actor.userId, seasonId: sessDetail.seasonId,
        audienceType: "SINGLE_PERSON", audienceRef: assigned.personId,
        channels: ["IN_APP", "EMAIL"], triggerType: "COACH_ASSIGNED_SESSION",
        subject: "You've been added to a class",
        body: `You're set as ${role.toLowerCase()} for ${teams || "a session"} on ${formatDate(sessDetail.date)} at ${formatTime12(sessDetail.startTime)}${sessDetail.facility ? ` · ${sessDetail.facility.name}` : ""}. The attached invite adds it to your calendar; subscribe to keep it in sync: ${feed}`,
        attachments,
      });
    }

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.addCoach", summary: `Added ${role.toLowerCase()} coach ${coachId}` });
    return back("?ok=subAdded");
  }

  if (op === "removeSessionCoach") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    const coachId = String(formData.get("coachId") ?? "").trim();
    if (!sessionId || !coachId) return back("?err=session");
    await prisma.sessionCoach.deleteMany({ where: { sessionId, coachId } });
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.removeCoach", summary: `Removed coach ${coachId}` });
    return back("?ok=subRemoved");
  }

  return back("?err=op");
}
