"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { generatePracticeDates, cancellationOutcome } from "@/lib/domain/schedule";

const PRACTICE_WEEKS = 6;
const DEFAULT_DURATION_MIN = 90;
const DEFAULT_COURTS = 2;

async function requireScheduler() {
  const session = await getSession();
  if (!session || !can(session.role, "manageScheduling")) {
    throw new Error("Not authorized to manage scheduling.");
  }
  return session;
}

async function requireAttendanceMarker() {
  const session = await getSession();
  if (!session || !can(session.role, "markAttendance")) {
    throw new Error("Not authorized to mark attendance.");
  }
  return session;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Generate the six practice-week sessions for a team from the season start (§7). */
export async function generateSchedule(formData: FormData) {
  const session = await requireScheduler();
  const teamId = String(formData.get("teamId") ?? "");
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { season: true, facility: true },
  });
  if (!team) throw new Error("Team not found.");
  if (!team.dayOfWeek || !team.startTime || !team.facilityId) {
    throw new Error("Set the team's day, time, and facility before generating a schedule.");
  }

  // Idempotent: don't double-generate practices.
  const existing = await prisma.session.count({
    where: { type: "PRACTICE", teams: { some: { teamId } } },
  });
  if (existing > 0) throw new Error("This team already has a practice schedule.");

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
    actorId: session.userId,
    entityType: "Team",
    entityId: teamId,
    action: "GENERATE_SCHEDULE",
    summary: `Generated ${created} practice sessions`,
  });

  revalidatePath("/console/schedule");
}

/** Cancel a session, applying the per-type rules and firing the trigger (§7, §13). */
export async function cancelSession(formData: FormData) {
  const session = await requireScheduler();
  const sessionId = String(formData.get("sessionId") ?? "");
  const reason = String(formData.get("reason") ?? "OTHER");

  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { teams: { include: { team: true } } },
  });
  if (!s) throw new Error("Session not found.");

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
      senderId: session.userId,
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
    actorId: session.userId,
    entityType: "Session",
    entityId: sessionId,
    action: "CANCEL",
    summary: `${s.type} → ${outcome.newStatus} (${reason}). ${outcome.note}`,
  });

  revalidatePath("/console/schedule");
  revalidatePath(`/console/schedule/${sessionId}`);
}

/** Relocate to an alternative (indoor) court, preserving the session (§7). */
export async function relocateSession(formData: FormData) {
  const session = await requireScheduler();
  const sessionId = String(formData.get("sessionId") ?? "");
  const facilityId = String(formData.get("facilityId") ?? "");
  if (!facilityId) throw new Error("Choose a facility to relocate to.");

  await prisma.session.update({
    where: { id: sessionId },
    data: { relocatedFacilityId: facilityId, status: "SCHEDULED", cancelReason: null },
  });
  await audit({ actorId: session.userId, entityType: "Session", entityId: sessionId, action: "RELOCATE", summary: `Relocated to facility ${facilityId}` });
  revalidatePath(`/console/schedule/${sessionId}`);
  revalidatePath("/console/schedule");
}

/** Coach marks attendance per player; saving confirms delivery (§7). */
export async function markAttendance(formData: FormData) {
  const session = await requireAttendanceMarker();
  const sessionId = String(formData.get("sessionId") ?? "");
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { teams: { include: { team: { include: { members: true } } } } },
  });
  if (!s) throw new Error("Session not found.");

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

  await audit({ actorId: session.userId, entityType: "Session", entityId: sessionId, action: "ATTENDANCE", summary: `Marked attendance for ${personIds.length} player(s)` });
  revalidatePath(`/console/schedule/${sessionId}`);
  revalidatePath("/console/schedule");
}
