import { NextResponse } from "next/server";
import { formatDate, formatTime12, parseSessionDateInput, isPastSchedulingDay } from "@/lib/time";
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
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { assignSessionSub } from "@/lib/domain/coachSub";
import { addTeamAssistantToSessions } from "@/lib/domain/teamCoachSessions";
import { isSessionComplete } from "@/lib/domain/coachPay";

// Schedule mutations as native-form-POST route handlers with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

const PRACTICE_WEEKS = 6;
// Practices are 2 hours.
const DEFAULT_DURATION_MIN = 120;
const DEFAULT_COURTS = 2;

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type SchedActor = { userId: string; roles: import("@/lib/enums").Role[] };

// Who may add/modify a session: admins (manageScheduling) for any, or the head/
// assistant coach of one of the session's teams for their own. Returns the mode
// so callers can alert admins when a COACH makes the change.
async function schedEditMode(actor: SchedActor, sessionId: string): Promise<"admin" | "coach" | null> {
  if (can(actor.roles, "manageScheduling")) return "admin";
  const mine = await coachedTeamIdsForUser(actor.userId);
  if (!mine.length) return null;
  const sess = await prisma.session.findUnique({ where: { id: sessionId }, select: { teams: { select: { teamId: true } } } });
  if (sess && sess.teams.some((t) => mine.includes(t.teamId))) return "coach";
  return null;
}

// Notify admins that a coach added/changed/removed a practice.
async function alertAdminsScheduleChange(actorUserId: string, seasonId: string, label: string, verb: string, link?: string) {
  const u = await prisma.user.findUnique({ where: { id: actorUserId }, select: { person: { select: { firstName: true, lastName: true } } } });
  const who = u?.person ? `${u.person.firstName} ${u.person.lastName}` : "A coach";
  await dispatchMessage({
    senderId: actorUserId, seasonId,
    audienceType: "ALL_ADMINS", triggerType: "COACH_SCHEDULE_CHANGE",
    channels: ["IN_APP", "EMAIL"],
    subject: `Coach ${verb} a practice`,
    body: `${who} ${verb} a practice: ${label}.${link ? ` ${link}` : ""}`,
  });
}

function schedLabel(s: { date: Date; startTime: string; facility: { name: string } | null; teams: { team: { name: string } }[] }): string {
  const teams = s.teams.map((t) => t.team.name).join(", ") || "a class";
  return `${teams} on ${formatDate(s.date)} at ${formatTime12(s.startTime)}${s.facility ? ` · ${s.facility.name}` : ""}`;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();

  // Where to bounce back to. Detail-page forms pass their own path; anything
  // else falls back to the schedule index.
  const rawReturn = String(formData.get("returnTo") ?? "");
  // Schedule actions can be driven from the Schedule page or a team's page, so
  // allow returning to either; anything else falls back to the schedule index.
  const returnTo = rawReturn.startsWith("/console/schedule") || rawReturn.startsWith("/console/teams/")
    ? rawReturn
    : "/console/schedule";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  // Reschedule a single session — date, time, and/or facility (§7). Notifies the
  // team(s) by default so families see the change (opt out with the checkbox).
  if (op === "editSession") {
    if (!actor) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    if (!sessionId) return back("?err=notfound");
    const mode = await schedEditMode(actor, sessionId);
    if (!mode) return back("?err=auth");
    const dateStr = String(formData.get("date") ?? "").trim();
    const startTime = String(formData.get("startTime") ?? "").trim();
    const endTime = String(formData.get("endTime") ?? "").trim();
    const facilityId = String(formData.get("facilityId") ?? "").trim() || null;
    const notify = String(formData.get("notify") ?? "") === "1";
    if (dateStr && !parseSessionDateInput(dateStr)) return back("?err=adddate");
    // A coach may not move a practice into the past (that would let it pay out
    // immediately). Admins can correct a date freely.
    if (mode === "coach" && isPastSchedulingDay(dateStr)) return back("?err=pastdate");
    const parsedDate = parseSessionDateInput(dateStr);
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

    // A coach changed the schedule — let admins know.
    if (mode === "coach") {
      const full = await prisma.session.findUnique({ where: { id: sessionId }, include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } } });
      if (full) await alertAdminsScheduleChange(actor.userId, updated.seasonId, schedLabel(full), "rescheduled", `${origin}/console/schedule/${sessionId}`);
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.edit", summary: `Rescheduled session${notify ? " + notified team" : ""}${mode === "coach" ? " (by coach)" : ""}` });
    return back("?ok=edited");
  }

  // generateSchedule — manageScheduling (§7)
  if (op === "generate") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

    const teamId = String(formData.get("teamId") ?? "");
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { season: true, facility: true, assistantCoaches: { select: { coachId: true } } },
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

    // Assistant coaches are paid for the team's sessions too — attach them.
    for (const ac of team.assistantCoaches) await addTeamAssistantToSessions(teamId, ac.coachId);

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

    // Pay-on-cancel: a cancelled class doesn't pay its coach by default, but the
    // admin is asked "Pay <coach> for this class?" and any coach they check is
    // still paid (e.g. a late cancellation the coach showed up for). Reset all
    // rows first so re-cancelling reflects the latest choice.
    const payCoachIds = formData.getAll("payCoach").map((v) => String(v)).filter(Boolean);
    await prisma.sessionCoach.updateMany({ where: { sessionId }, data: { paidIfCancelled: false } });
    if (payCoachIds.length) {
      await prisma.sessionCoach.updateMany({
        where: { sessionId, coachId: { in: payCoachIds } },
        data: { paidIfCancelled: true },
      });
    }

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
      summary: `${s.type} → ${outcome.newStatus} (${reason}). ${payCoachIds.length ? `Paying ${payCoachIds.length} coach(es) despite cancellation. ` : "No coach pay. "}${outcome.note}`,
    });

    return back("?ok=cancel");
  }

  // A coach can't call off a class themselves (families plan around it, and a
  // silent delete has no notice) — instead they ask an admin, who cancels it
  // properly (with the team notice + pay decision). This just alerts the admins.
  if (op === "requestCancel") {
    if (!actor) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    const mode = await schedEditMode(actor, sessionId);
    if (!mode) return back("?err=auth");
    const reason = String(formData.get("reason") ?? "").trim();
    const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } } });
    if (!s) return back("?err=session");
    const label = schedLabel(s);
    await alertAdminsScheduleChange(actor.userId, s.seasonId, `${label}${reason ? ` — reason: ${reason}` : ""}`, "requested cancellation of", `${origin}/console/schedule/${sessionId}`);
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.requestCancel", summary: `Coach requested cancellation${reason ? ` (${reason})` : ""}` });
    return back("?ok=cancelrequested");
  }

  // Hard-delete a single session — for one created by mistake. Quiet: no team
  // notification (use Cancel for that). Join rows (teams, coaches, attendance)
  // cascade away. Admins only — a coach uses requestCancel instead.
  if (op === "deleteSession") {
    if (!actor) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    const mode = await schedEditMode(actor, sessionId);
    if (!mode) return back("?err=auth");
    // Deleting a session is destructive and silent — restrict it to admins.
    // A coach who wants a class called off uses requestCancel (alerts admins).
    if (mode !== "admin") return back("?err=auth");
    const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } } });
    if (!s) return back("?err=session");
    try {
      await prisma.session.delete({ where: { id: sessionId } });
    } catch {
      return back("?err=sessionlinked");
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "DELETE", summary: `Deleted ${s.type} on ${formatDate(s.date)}` });
    // Don't bounce back to the session we just deleted (that page now 404s).
    const deletedPath = `/console/schedule/${sessionId}`;
    if (returnTo === deletedPath || returnTo.startsWith(`${deletedPath}?`) || returnTo.startsWith(`${deletedPath}#`)) {
      return NextResponse.redirect(new URL(`/console/schedule?ok=deleted`, origin), 303);
    }
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

  // Make a planned practice real so a coach can check players in — the one-tap
  // path from the team's "Check players in" list. Ensures a PRACTICE session
  // exists for the given date, generating the whole season the first time (no
  // notification — the coach triggered it), then lands on that session's
  // attendance screen. Admins for any team; a coach for their own team.
  if (op === "ensurePractice") {
    if (!actor) return back("?err=auth");
    const teamId = String(formData.get("teamId") ?? "");
    const dateStr = String(formData.get("date") ?? "").trim();
    const team = await prisma.team.findUnique({ where: { id: teamId }, include: { season: { select: { startDate: true } }, assistantCoaches: { select: { coachId: true } } } });
    if (!team) return back("?err=team");
    if (!can(actor.roles, "manageScheduling")) {
      const mine = await coachedTeamIdsForUser(actor.userId);
      if (!mine.includes(teamId)) return back("?err=notyourteam");
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return back("?err=adddate");
    const target = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    const dayStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const endTime = addMinutes(team.startTime ?? "17:00", DEFAULT_DURATION_MIN);

    // First check-in for this team: generate the season so the schedule is whole
    // (never a partial one-off set), quietly — no coach email.
    const existingCount = await prisma.session.count({ where: { type: "PRACTICE", teams: { some: { teamId } } } });
    if (existingCount === 0 && team.dayOfWeek && team.startTime && team.season?.startDate) {
      const blackouts = (await prisma.blackoutDate.findMany({ where: { OR: [{ facilityId: null }, { facilityId: team.facilityId }] } })).map((b) => b.date);
      const dates = generatePracticeDates(team.season.startDate, team.dayOfWeek, PRACTICE_WEEKS, blackouts);
      for (let i = 0; i < dates.length; i++) {
        await prisma.session.create({
          data: {
            seasonId: team.seasonId, type: "PRACTICE", facilityId: team.facilityId,
            date: dates[i], startTime: team.startTime, endTime, courtCount: DEFAULT_COURTS,
            status: "SCHEDULED", weekNumber: i + 1,
            teams: { create: { teamId } },
            ...(team.coachId ? { coaches: { create: { coachId: team.coachId, role: "PRIMARY" } } } : {}),
          },
        });
      }
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "GENERATE_SCHEDULE", summary: `Generated ${dates.length} practices (check-in)` });
    }

    // Find the session for the requested day; create a single one if it's still
    // missing (e.g. a make-up date outside the six generated weeks).
    let sess = await prisma.session.findFirst({
      where: { type: "PRACTICE", teams: { some: { teamId } }, date: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    });
    if (!sess) {
      const created = await prisma.session.create({
        data: {
          seasonId: team.seasonId, type: "PRACTICE", facilityId: team.facilityId,
          date: target, startTime: team.startTime ?? "17:00", endTime, courtCount: DEFAULT_COURTS,
          status: "SCHEDULED",
          teams: { create: { teamId } },
          ...(team.coachId ? { coaches: { create: { coachId: team.coachId, role: "PRIMARY" } } } : {}),
        },
        select: { id: true },
      });
      sess = created;
    }
    // Keep assistant coaches attached (and paid) on the team's sessions.
    for (const ac of team.assistantCoaches) await addTeamAssistantToSessions(teamId, ac.coachId);
    return NextResponse.redirect(new URL(`/console/schedule/${sess.id}#attendance`, origin), 303);
  }

  // Add a single one-off practice for a team and (by default) notify the team.
  // Complements bulk "generate" — for a make-up session or an extra practice.
  // Admins may add for any team; a coach may add ONLY for a team they head or
  // assist (their own roster).
  if (op === "addSession") {
    if (!actor) return back("?err=auth");
    const teamId = String(formData.get("teamId") ?? "");
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return back("?err=team");
    const addByCoach = !can(actor.roles, "manageScheduling");
    if (addByCoach) {
      const mine = await coachedTeamIdsForUser(actor.userId);
      if (!mine.includes(teamId)) return back("?err=notyourteam");
    }

    const dateStr = String(formData.get("date") ?? "").trim();
    const parsed = parseSessionDateInput(dateStr);
    if (!parsed) return back("?err=adddate");
    // A practice can't be backdated: a past date would make the session look
    // "complete" the moment it's saved and pay the coach without it happening.
    if (isPastSchedulingDay(dateStr)) return back("?err=pastdate");
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

    // A coach added a practice — alert admins.
    if (addByCoach) {
      const fac = facilityId ? await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }) : null;
      const label = `${team.name} on ${formatDate(parsed)} at ${formatTime12(startTime)}${fac ? ` · ${fac.name}` : ""}`;
      await alertAdminsScheduleChange(actor.userId, team.seasonId, label, "added", `${origin}/console/schedule/${created.id}`);
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: created.id, action: "session.add", summary: `Added a practice for ${team.name}${notify ? " + notified team" : ""}${addByCoach ? " (by coach)" : ""}` });
    return back(notify ? "?ok=added" : "?ok=addedquiet");
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
    // Only record players the coach actually marked. A blank radio means "not
    // recorded yet" — never a silent PRESENT — so attendance reflects real
    // check-in, not an unset default (F-07).
    let marked = 0;
    for (const personId of personIds) {
      const raw = formData.get(`att_${personId}`);
      if (raw == null || String(raw) === "") continue;
      const status = String(raw);
      await prisma.attendance.upsert({
        where: { sessionId_personId: { sessionId, personId } },
        create: { sessionId, personId, status },
        update: { status },
      });
      marked++;
    }

    // Marking attendance confirms a session that has actually happened — but a
    // coach can (and does) check players in for an UPCOMING practice. Only flip
    // to DELIVERED once the class is over by the clock AND at least one player
    // was recorded; otherwise leave it SCHEDULED so the "Need a sub?" panel and
    // an open sub request stay live. (Pay accrues on completion by time, not on
    // this status — see coachPay.ts.)
    if (marked > 0 && s.status === "SCHEDULED" && isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status })) {
      await prisma.session.update({ where: { id: sessionId }, data: { status: "DELIVERED" } });
    }

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "ATTENDANCE", summary: `Marked attendance for ${marked} of ${personIds.length} player(s)` });

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
    await assignSessionSub({ sessionId, coachId, role, actorId: actor.userId, origin });

    // Assigning a coach resolves any open/pending sub request for this class.
    await prisma.subRequest.updateMany({
      where: { sessionId, status: { in: ["OPEN", "PENDING"] } },
      data: { status: "APPROVED", claimedByCoachId: coachId },
    });

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.addCoach", summary: `Added ${role.toLowerCase()} coach ${coachId}` });
    return back("?ok=subAdded");
  }

  if (op === "removeSessionCoach") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");
    const sessionId = String(formData.get("sessionId") ?? "");
    const coachId = String(formData.get("coachId") ?? "").trim();
    if (!sessionId || !coachId) return back("?err=session");
    await prisma.sessionCoach.deleteMany({ where: { sessionId, coachId } });
    // If no substitute is left covering this class, the normal (PRIMARY) coach
    // works it again — restore their pay for the session.
    const subsLeft = await prisma.sessionCoach.count({ where: { sessionId, role: "SUBSTITUTE" } });
    if (subsLeft === 0) {
      await prisma.sessionCoach.updateMany({ where: { sessionId, role: "PRIMARY" }, data: { payable: true } });
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "session.removeCoach", summary: `Removed coach ${coachId}` });
    return back("?ok=subRemoved");
  }

  return back("?err=op");
}
