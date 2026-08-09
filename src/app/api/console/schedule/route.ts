import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { generatePracticeDates, cancellationOutcome } from "@/lib/domain/schedule";

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

    let created = 0;
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
      created++;
      void s;
    }

    await audit({
      actorId: actor.userId,
      entityType: "Team",
      entityId: teamId,
      action: "GENERATE_SCHEDULE",
      summary: `Generated ${created} practice sessions`,
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
          ? `Your ${st.team.name} practice on ${s.date.toLocaleDateString()} is cancelled (${reasonLabel}). There is no make-up — your place on the team is unchanged.`
          : `Your ${st.team.name} fixture on ${s.date.toLocaleDateString()} will be rescheduled within 14 days (${reasonLabel}). Details to follow.`,
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

  // relocateSession — manageScheduling (§7)
  if (op === "relocate") {
    if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

    const sessionId = String(formData.get("sessionId") ?? "");
    const facilityId = String(formData.get("facilityId") ?? "");
    if (!facilityId) return back("?err=facility");

    await prisma.session.update({
      where: { id: sessionId },
      data: { relocatedFacilityId: facilityId, status: "SCHEDULED", cancelReason: null },
    });
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "RELOCATE", summary: `Relocated to facility ${facilityId}` });

    return back("?ok=relocate");
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

  return back("?err=op");
}
