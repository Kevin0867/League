import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { coachingReportEmail } from "@/lib/domain/coachingReportEmail";
import { isValidWeek, serializeTags, parseTags, labelsFor } from "@/lib/domain/coachingNotes";
import { personContacts, filterToContacts } from "@/lib/domain/contacts";

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

    // Send this week's note to the family. The coach/admin chooses the channel:
    //   email — to the hand-picked addresses from the "Send to" checklist
    //   text  — to the family mobile (the guardian's for a minor, else the
    //           player's; a minor is never texted directly)
    //   both  — email AND text
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

      const channel = String(fd.get("channel") ?? "email"); // email | text | both
      const wantEmail = channel === "email" || channel === "both";
      const wantText = channel === "text" || channel === "both";

      const coachName = auth.team.coach
        ? `${auth.team.coach.person.firstName} ${auth.team.coach.person.lastName}`
        : "Your PURE coach";
      const strengths = labelsFor(parseTags(note.strengths));
      const growth = labelsFor(parseTags(note.growth));
      const email = coachingReportEmail({
        studentFirstName: student.firstName,
        teamName: auth.team.name,
        week,
        coachName,
        strengths,
        growth,
        note: note.note,
      });

      // Aggregate the outcome across the chosen channels.
      let attempted = false;      // at least one channel actually sent something
      let anyFailure = false;
      let anySimulated = false;
      const reasons: string[] = [];
      let emailNoAddress = false; // email chosen but nobody checked / no address
      let textNoPhone = false;    // text chosen but no family mobile on file

      // EMAIL — to the hand-picked addresses (validated against real contacts).
      if (wantEmail) {
        const contacts = personContacts(student, student.isMinor ? student.guardian : null);
        const picked = filterToContacts(fd.getAll("to").map((v) => String(v)), contacts);
        if (picked.length === 0) {
          emailNoAddress = true;
        } else {
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
            toEmails: picked,
          });
          attempted = true;
          if (res.failures > 0) { anyFailure = true; reasons.push(...res.failureReasons); }
          else if (res.simulated > 0) anySimulated = true;
        }
      }

      // TEXT — to the family mobile. For a minor that's the guardian (never the
      // child); for an adult it's their own number. Resolve the target person so
      // dispatch pulls the right phone.
      if (wantText) {
        const smsTargetId = student.isMinor && student.guardianId ? student.guardianId : student.id;
        const smsPhone = ((student.isMinor && student.guardian ? student.guardian.phone : student.phone) ?? "").trim();
        if (!smsPhone) {
          textNoPhone = true;
        } else {
          const parts = [
            `${student.firstName}'s Week ${week} update — ${auth.team.name}.`,
            strengths.length ? `Excelling at: ${strengths.join(", ")}.` : "",
            growth.length ? `Working on: ${growth.join(", ")}.` : "",
            (note.note ?? "").trim(),
            `— ${coachName}`,
          ].filter(Boolean);
          const smsBody = parts.join(" ").slice(0, 900);
          const res = await dispatchMessage({
            senderId: actor.userId,
            seasonId: auth.team.seasonId,
            audienceType: "SINGLE_PERSON",
            audienceRef: smsTargetId,
            channels: ["SMS"],
            triggerType: "PROGRESS_REPORT",
            subject: email.subject,
            body: email.text,
            smsBody,
          });
          attempted = true;
          if (res.failures > 0) { anyFailure = true; reasons.push(...res.failureReasons); }
          else if (res.simulated > 0) anySimulated = true;
        }
      }

      // Nothing could be sent — tell the coach exactly why for the chosen channel.
      if (!attempted) {
        if (wantText && !wantEmail && textNoPhone) return progress(`?err=nophone&week=${week}`);
        if (wantEmail && !wantText && emailNoAddress) return progress(`?err=norecipients&week=${week}`);
        return progress(`?err=nodest&week=${week}`);
      }
      if (anyFailure) {
        const reason = reasons[0] ?? "send failed";
        await audit({ actorId: actor.userId, entityType: "CoachingNote", entityId: `${teamId}:${personId}:${week}`, action: "coachingNote.sendFailed", summary: `Week ${week} report failed: ${reason}` });
        return progress(`?err=sendfail&week=${week}&reason=${encodeURIComponent(reason.slice(0, 180))}`);
      }

      await prisma.coachingNote.update({ where: { id: note.id }, data: { sentToParentAt: new Date() } });
      const via = wantEmail && wantText ? "email & text" : wantText ? "text" : "email";
      await audit({ actorId: actor.userId, entityType: "CoachingNote", entityId: `${teamId}:${personId}:${week}`, action: "coachingNote.sent", summary: anySimulated ? `Week ${week} report simulated via ${via} (provider unconfigured)` : `Sent Week ${week} report via ${via}` });
      return progress(`?ok=${anySimulated ? "sentsim" : "sent"}&week=${week}&via=${encodeURIComponent(via)}`);
    }

    default:
      return progress("?err=op");
  }
}
