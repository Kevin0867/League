import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAdmin } from "@/lib/rbac";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { notifySubNeeded, notifySubSuggested, notifyEventAdded, notifySubReleased, notifySubMoved, notifySubJoined, notifySubRemoved } from "@/lib/domain/teamCalendar";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { sendResetLinkForPerson } from "@/lib/domain/passwordResetSend";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { ageFromDob } from "@/lib/domain/messaging-acl";
import { formatSessionDay, formatTime12 } from "@/lib/time";

export const dynamic = "force-dynamic";

/** The person ids that count as "me" — the actor plus any dependents. */
async function householdOf(personId: string | null): Promise<string[]> {
  if (!personId) return [];
  const deps = await prisma.person.findMany({ where: { guardianId: personId }, select: { id: true } });
  return [personId, ...deps.map((d) => d.id)];
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const teamId = String(fd.get("teamId") ?? "").trim();
  const sessionId = String(fd.get("sessionId") ?? "").trim();
  const rawReturn = String(fd.get("returnTo") ?? "").trim();
  const dest = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : `/portal/team/${teamId}/calendar`;
  const back = (qs: string) => NextResponse.redirect(new URL(`${dest}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const household = await householdOf(me?.personId ?? null);
  if (!teamId) return back("?err=fields");

  // Membership: a household member is on this team, OR the actor is a coach of
  // it / an admin.
  const memberIds = (await prisma.teamMember.findMany({ where: { teamId, personId: { in: household } }, select: { personId: true } })).map((m) => m.personId);
  const admin = isAdmin(actor.roles);
  const isCoach = !admin && (await coachedTeamIdsForUser(actor.userId)).includes(teamId);
  const isCoachOrAdmin = admin || isCoach;
  if (memberIds.length === 0 && !isCoachOrAdmin) return back("?err=perm");

  // ── Team-added calendar events (no session needed) ──────────────────────────
  // Team members, the coach, and admins can add an event; adding notifies the
  // whole team + coach and records who added it.
  if (op === "addEvent") {
    const title = String(fd.get("title") ?? "").trim().slice(0, 140);
    const dateStr = String(fd.get("date") ?? "").trim();
    if (!title || !dateStr) return back("?err=eventfields");
    // Store at noon UTC so it lands on the intended day in Phoenix (UTC-7).
    const date = new Date(`${dateStr}T12:00:00Z`);
    if (isNaN(date.getTime())) return back("?err=eventfields");
    const startTime = String(fd.get("startTime") ?? "").trim() || null;
    const endTime = String(fd.get("endTime") ?? "").trim() || null;
    const location = String(fd.get("location") ?? "").trim().slice(0, 200) || null;
    const description = String(fd.get("description") ?? "").trim().slice(0, 1000) || null;
    const role = admin ? "ADMIN" : isCoach ? "COACH" : "PLAYER";
    const meName = me?.personId
      ? await prisma.person.findUnique({ where: { id: me.personId }, select: { firstName: true, lastName: true } })
      : null;
    const ev = await prisma.teamEvent.create({
      data: {
        teamId, title, description, location, date, startTime, endTime,
        createdByPersonId: me?.personId ?? null,
        createdByName: meName ? `${meName.firstName} ${meName.lastName}`.trim() : null,
        createdByRole: role,
      },
    });
    await audit({ actorId: actor.userId, entityType: "TeamEvent", entityId: ev.id, action: "calendar.addEvent", summary: `Added team event "${title}"` });
    await notifyEventAdded(teamId, ev, actor.userId);
    return back("?ok=eventadded#e-" + ev.id);
  }

  if (op === "deleteEvent") {
    const eventId = String(fd.get("eventId") ?? "").trim();
    if (!eventId) return back("?err=fields");
    const ev = await prisma.teamEvent.findUnique({ where: { id: eventId }, select: { teamId: true, createdByPersonId: true } });
    if (!ev || ev.teamId !== teamId) return back("?err=perm");
    const mine = !!ev.createdByPersonId && household.includes(ev.createdByPersonId);
    if (!mine && !isCoachOrAdmin) return back("?err=perm");
    await prisma.teamEvent.delete({ where: { id: eventId } });
    await audit({ actorId: actor.userId, entityType: "TeamEvent", entityId: eventId, action: "calendar.deleteEvent", summary: "Removed team event" });
    return back("?ok=eventdeleted");
  }

  // The remaining ops all act on a specific session.
  if (!sessionId) return back("?err=fields");

  if (op === "absent") {
    // Mark a household member out for this session.
    const who = String(fd.get("personId") ?? "").trim() || memberIds[0] || household[0];
    if (!who || (!memberIds.includes(who) && !isCoachOrAdmin)) return back("?err=perm");
    await prisma.playerAbsence.upsert({
      where: { sessionId_personId: { sessionId, personId: who } },
      create: { sessionId, personId: who, teamId, note: String(fd.get("note") ?? "").trim().slice(0, 300) || null },
      update: {},
    });
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "calendar.absent", summary: `Marked ${who} out` });
    await notifySubNeeded(sessionId, teamId);
    return back("?ok=absent#s-" + sessionId);
  }

  if (op === "present") {
    const who = String(fd.get("personId") ?? "").trim() || memberIds[0] || household[0];
    await prisma.playerAbsence.deleteMany({ where: { sessionId, personId: who } });
    return back("?ok=present#s-" + sessionId);
  }

  if (op === "suggest") {
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim().toLowerCase() || null;
    const phone = String(fd.get("phone") ?? "").trim() || null;
    if (!name || (!email && !phone)) return back("?err=subfields#s-" + sessionId);
    await prisma.subSuggestion.create({ data: { sessionId, teamId, suggestedByPersonId: me?.personId ?? null, name, email, phone } });
    const byName = me?.personId ? (await prisma.person.findUnique({ where: { id: me.personId }, select: { firstName: true, lastName: true } })) : null;
    await notifySubSuggested(sessionId, teamId, { name, email, phone }, byName ? `${byName.firstName} ${byName.lastName}`.trim() : "A teammate");
    return back("?ok=suggested#s-" + sessionId);
  }

  // Coach/admin: add a substitute for this specific date. Creates/reuses the
  // person, records them as a sub for the session (clearing an open spot), and
  // sends a welcome + waiver so they're cleared to play. Subs aren't charged.
  if (op === "addSub") {
    if (!isCoachOrAdmin) return back("?err=perm");
    const first = String(fd.get("firstName") ?? "").trim();
    const last = String(fd.get("lastName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim().toLowerCase() || null;
    const phone = String(fd.get("phone") ?? "").trim() || null;
    const dobStr = String(fd.get("dob") ?? "").trim();
    const suggestionId = String(fd.get("suggestionId") ?? "").trim() || null;
    if (!first || !last || (!email && !phone)) return back("?err=subaddfields#s-" + sessionId);
    const dob = dobStr ? new Date(dobStr) : null;
    const age = dob && !isNaN(dob.getTime()) ? ageFromDob(dob) : null;

    let personId: string;
    try {
      personId = await prisma.$transaction(async (tx) => {
        const existing = email ? await tx.person.findFirst({ where: { email, NOT: { isMinor: true } }, select: { id: true } }) : null;
        const pid = existing ? existing.id : (await tx.person.create({ data: { firstName: first, lastName: last, email, phone, dob: dob && !isNaN(dob.getTime()) ? dob : null, isMinor: age !== null ? age < 18 : false }, select: { id: true } })).id;
        if (existing && phone) await tx.person.update({ where: { id: pid }, data: { phone } });
        await tx.sessionSub.upsert({ where: { sessionId_personId: { sessionId, personId: pid } }, create: { sessionId, personId: pid, teamId, addedByUserId: actor.userId }, update: {} });
        if (suggestionId) await tx.subSuggestion.updateMany({ where: { id: suggestionId }, data: { status: "ADDED", addedPersonId: pid } });
        return pid;
      });
    } catch (e) {
      return back(`?err=subaddfailed#s-${sessionId}`);
    }

    // Welcome + waiver so the sub is cleared to play. Best-effort. Include the
    // practice day/time/place so the sub knows exactly when they're subbing.
    const subSession = await prisma.session.findUnique({ where: { id: sessionId }, select: { date: true, startTime: true, teams: { select: { team: { select: { name: true } } } }, facility: { select: { name: true, isPrivate: true } } } });
    const subWhen = subSession ? `${formatSessionDay(subSession.date, "long")} at ${formatTime12(subSession.startTime)}` : "the upcoming practice";
    const subTeamName = subSession?.teams[0]?.team.name ?? "the team";
    const subWhere = subSession?.facility?.name && !subSession.facility.isPrivate ? ` at ${subSession.facility.name}` : "";
    try {
      const token = await signWaiverToken(personId);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const em = waiverRequestEmail({ name: first, link, isMinor: age !== null ? age < 18 : false });
      if (email) await sendEmail(email, em.subject, em.text, em.html).catch(() => {});
      if (phone) await sendSms(phone, `PURE Academy — you're subbing in for ${subTeamName} on ${subWhen}${subWhere}! Please complete this quick participation waiver so you're cleared to play: ${link} You'll also get the normal practice reminders.`).catch(() => {});
    } catch { /* best-effort */ }
    await sendResetLinkForPerson(personId).catch(() => {});
    // Notify the coach + team that a sub is joining them for this date.
    await notifySubJoined(sessionId, teamId, `${first} ${last}`.trim()).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "calendar.addSub", summary: `Added sub ${first} ${last}` });
    return back("?ok=subadded#s-" + sessionId);
  }

  // Coach/admin: remove a sub from this practice. Their SessionSub is deleted,
  // which reopens the spot (the player's absence is still uncovered), so it goes
  // straight back onto the public open-spots page for someone else to claim. The
  // removed sub is told their spot was released.
  if (op === "removeSub") {
    if (!isCoachOrAdmin) return back("?err=perm");
    const personId = String(fd.get("personId") ?? "").trim();
    if (!personId) return back("?err=fields");
    const removed = await prisma.sessionSub.deleteMany({ where: { sessionId, personId, teamId } });
    if (removed.count > 0) {
      await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "calendar.removeSub", summary: `Removed sub ${personId}` });
      // Tell the sub their spot was released, AND tell the coach their roster changed.
      await notifySubReleased(sessionId, teamId, personId).catch(() => {});
      await notifySubRemoved(sessionId, teamId, personId).catch(() => {});
    }
    return back("?ok=subremoved#s-" + sessionId);
  }

  // Coach/admin: move a sub from this practice to another of the same team's
  // upcoming practices. The origin spot reopens (back on the website); the sub
  // and the target date's team/coach are notified.
  if (op === "moveSub") {
    if (!isCoachOrAdmin) return back("?err=perm");
    const personId = String(fd.get("personId") ?? "").trim();
    const toSessionId = String(fd.get("toSessionId") ?? "").trim();
    if (!personId || !toSessionId || toSessionId === sessionId) return back("?err=fields");
    // The destination must be a session this same team is on.
    const target = await prisma.session.findFirst({ where: { id: toSessionId, teams: { some: { teamId } } }, select: { id: true } });
    if (!target) return back("?err=movedest#s-" + sessionId);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.sessionSub.deleteMany({ where: { sessionId, personId } });
        await tx.sessionSub.upsert({
          where: { sessionId_personId: { sessionId: toSessionId, personId } },
          create: { sessionId: toSessionId, personId, teamId, addedByUserId: actor.userId },
          update: {},
        });
      });
    } catch {
      return back("?err=movefailed#s-" + sessionId);
    }
    const p = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true } });
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "calendar.moveSub", summary: `Moved sub ${personId} to ${toSessionId}` });
    // Sub + the NEW date's coach/team are notified by notifySubMoved; also tell the
    // OLD date's coach the sub left that practice.
    await notifySubMoved(toSessionId, teamId, personId, p ? `${p.firstName} ${p.lastName}`.trim() : "A sub").catch(() => {});
    await notifySubRemoved(sessionId, teamId, personId).catch(() => {});
    return back("?ok=submoved#s-" + sessionId);
  }

  return back("?err=op");
}
