import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAdmin } from "@/lib/rbac";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { notifySubNeeded, notifySubSuggested } from "@/lib/domain/teamCalendar";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { sendResetLinkForPerson } from "@/lib/domain/passwordResetSend";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { ageFromDob } from "@/lib/domain/messaging-acl";

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
  if (!teamId || !sessionId) return back("?err=fields");

  // Membership: a household member is on this team, OR the actor is a coach of
  // it / an admin.
  const memberIds = (await prisma.teamMember.findMany({ where: { teamId, personId: { in: household } }, select: { personId: true } })).map((m) => m.personId);
  const isCoachOrAdmin = isAdmin(actor.roles) || (await coachedTeamIdsForUser(actor.userId)).includes(teamId);
  if (memberIds.length === 0 && !isCoachOrAdmin) return back("?err=perm");

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

    // Welcome + waiver so the sub is cleared to play. Best-effort.
    try {
      const token = await signWaiverToken(personId);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const em = waiverRequestEmail({ name: first, link, isMinor: age !== null ? age < 18 : false });
      if (email) await sendEmail(email, em.subject, em.text, em.html).catch(() => {});
      if (phone) await sendSms(phone, `PURE Academy — you're subbing in! Please complete this quick participation waiver so you're cleared to play: ${link}`).catch(() => {});
    } catch { /* best-effort */ }
    await sendResetLinkForPerson(personId).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "calendar.addSub", summary: `Added sub ${first} ${last}` });
    return back("?ok=subadded#s-" + sessionId);
  }

  return back("?err=op");
}
