import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { coachingReportEmail } from "@/lib/domain/coachingReportEmail";
import { isValidWeek, serializeTags, parseTags, labelsFor } from "@/lib/domain/coachingNotes";
import { personEmails } from "@/lib/domain/audience";

// Coaching notes / progress reports (native-form-POST + ticket auth, 303 back).
// A coach keeps up to six weekly notes per student and can email a week's report
// to the parent. Access: admins, or the team's own head/assistant coach.
export const dynamic = "force-dynamic";

type Actor = { userId: string; role: import("@/lib/enums").Role; roles: import("@/lib/enums").Role[] };

// Admins with manageTeams pass; otherwise the actor must be this team's head or
// assistant coach (their own roster). Returns the team when allowed.
async function authorizeTeamNotes(actor: Actor, teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { coach: { include: { person: true } }, assistantCoaches: { select: { coachId: true } } },
  });
  if (!team) return { ok: false as const, team: null };
  if (can(actor.roles, "manageTeams")) return { ok: true as const, team };
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const myCoach = me?.personId
    ? await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } })
    : null;
  if (myCoach && (team.coachId === myCoach.id || team.assistantCoaches.some((tc) => tc.coachId === myCoach.id))) {
    return { ok: true as const, team };
  }
  return { ok: false as const, team: null };
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  const op = String(fd.get("op") ?? "");
  const teamId = String(fd.get("teamId") ?? "");
  const personId = String(fd.get("personId") ?? "");
  const week = parseInt(String(fd.get("week") ?? ""), 10);

  const progress = (qs: string) =>
    NextResponse.redirect(new URL(`/console/teams/${teamId}/progress/${personId}${qs}`, origin), 303);

  if (!actor) return progress("?err=auth");
  if (!teamId || !personId) return NextResponse.redirect(new URL(`/console/teams`, origin), 303);
  if (!isValidWeek(week)) return progress("?err=week");

  const auth = await authorizeTeamNotes(actor, teamId);
  if (!auth.ok || !auth.team) return progress("?err=auth");

  // The student must actually be on this team's roster.
  const member = await prisma.teamMember.findUnique({ where: { teamId_personId: { teamId, personId } } });
  if (!member) return progress("?err=notmember");

  switch (op) {
    // Create or update this week's note (preset tags + free-text).
    case "saveNote": {
      const strengths = serializeTags(fd.getAll("strengths").map((v) => String(v)));
      const growth = serializeTags(fd.getAll("growth").map((v) => String(v)));
      const note = String(fd.get("note") ?? "").trim() || null;
      await prisma.coachingNote.upsert({
        where: { teamId_personId_week: { teamId, personId, week } },
        create: { teamId, personId, week, strengths, growth, note, authorId: actor.userId },
        update: { strengths, growth, note, authorId: actor.userId },
      });
      await audit({ actorId: actor.userId, entityType: "CoachingNote", entityId: `${teamId}:${personId}:${week}`, action: "coachingNote.save", summary: `Saved Week ${week} coaching note` });
      return progress(`?ok=saved&week=${week}`);
    }

    // Email this week's note to the student's parent/guardian (or the student
    // directly if they're an adult with no guardian on file).
    case "sendReport": {
      const note = await prisma.coachingNote.findUnique({ where: { teamId_personId_week: { teamId, personId, week } } });
      if (!note || (parseTags(note.strengths).length === 0 && parseTags(note.growth).length === 0 && !note.note)) {
        return progress(`?err=empty&week=${week}`);
      }
      const student = await prisma.person.findUnique({
        where: { id: personId },
        include: { guardian: true },
      });
      if (!student) return progress(`?err=nostudent&week=${week}`);

      // Recipients: everyone on the student's record plus, for a minor, the
      // guardian's addresses — so both parents and the student all get it.
      // dispatchMessage to the student expands to the guardian and fans out to
      // every stored email; here we just confirm at least one exists.
      const targets = new Set(personEmails(student).map((e) => e.toLowerCase()));
      if (student.isMinor && student.guardian) personEmails(student.guardian).forEach((e) => targets.add(e.toLowerCase()));
      if (targets.size === 0) return progress(`?err=noemail&week=${week}`);

      const coachName = auth.team.coach
        ? `${auth.team.coach.person.firstName} ${auth.team.coach.person.lastName}`
        : "Your PURE coach";
      const email = coachingReportEmail({
        studentFirstName: student.firstName,
        teamName: auth.team.name,
        week,
        coachName,
        strengths: labelsFor(parseTags(note.strengths)),
        growth: labelsFor(parseTags(note.growth)),
        note: note.note,
      });

      const res = await dispatchMessage({
        senderId: actor.userId,
        seasonId: auth.team.seasonId,
        audienceType: "SINGLE_PERSON",
        audienceRef: student.id,
        channels: ["EMAIL"],
        triggerType: "PROGRESS_REPORT",
        subject: email.subject,
        body: email.text,
        html: email.html,
      });

      if (res.failures > 0) {
        const reason = res.failureReasons[0] ?? "send failed";
        await audit({ actorId: actor.userId, entityType: "CoachingNote", entityId: `${teamId}:${personId}:${week}`, action: "coachingNote.sendFailed", summary: `Week ${week} report failed: ${reason}` });
        return progress(`?err=sendfail&week=${week}&reason=${encodeURIComponent(reason.slice(0, 180))}`);
      }
      await prisma.coachingNote.update({ where: { id: note.id }, data: { sentToParentAt: new Date() } });
      await audit({ actorId: actor.userId, entityType: "CoachingNote", entityId: `${teamId}:${personId}:${week}`, action: "coachingNote.sent", summary: res.simulated ? `Week ${week} report simulated (provider unconfigured)` : `Emailed Week ${week} report to ${res.recipients} recipient(s)` });
      return progress(`?ok=${res.simulated ? "sentsim" : "sent"}&week=${week}`);
    }

    default:
      return progress("?err=op");
  }
}
