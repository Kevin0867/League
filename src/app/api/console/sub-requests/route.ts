import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { assignSessionSub } from "@/lib/domain/coachSub";
import { coachSessionConflicts } from "@/lib/domain/coachSchedule";
import { formatDate, formatTime12 } from "@/lib/time";

// Coach substitute requests. A class's coach (or an admin) opens a request; other
// coaches claim it from the Coaches' Lounge, which assigns them as the sub. Native
// form POST + ticket auth, 303 back to the page it came from.
export const dynamic = "force-dynamic";

const NOTIFY_CHANNELS: Record<string, ("IN_APP" | "EMAIL" | "SMS")[]> = {
  INAPP: ["IN_APP"],
  EMAIL: ["IN_APP", "EMAIL"],
  TEXT: ["IN_APP", "SMS"],
};

// Resolve the acting user's Coach.id (null if they aren't a coach).
async function actorCoachId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { personId: true } });
  if (!u?.personId) return null;
  const c = await prisma.coach.findUnique({ where: { personId: u.personId }, select: { id: true } });
  return c?.id ?? null;
}

function sessionLabel(s: { date: Date; startTime: string; facility: { name: string } | null; teams: { team: { name: string } }[] }): string {
  const teams = s.teams.map((t) => t.team.name).join(", ") || "a class";
  return `${teams} on ${formatDate(s.date)} at ${formatTime12(s.startTime)}${s.facility ? ` · ${s.facility.name}` : ""}`;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const rawReturn = String(fd.get("returnTo") ?? "");
  const returnTo = rawReturn.startsWith("/console/") ? rawReturn : "/console/lounge";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");
  const op = String(fd.get("op") ?? "");
  const isAdmin = can(actor.roles, "manageScheduling");
  const myCoachId = await actorCoachId(actor.userId);

  // --- Open a sub request for a class ---
  if (op === "request") {
    const sessionId = String(fd.get("sessionId") ?? "");
    const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;
    const notify = String(fd.get("notify") ?? "INAPP");
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true, coachId: true, assistantCoaches: { select: { coachId: true } } } } } } },
    });
    if (!session) return back("?srerr=notfound");

    // Who may ask: an admin, or a coach tied to this class (its session coach, or
    // the team's head/assistant coach).
    const teamCoachIds = new Set<string>();
    for (const st of session.teams) {
      if (st.team.coachId) teamCoachIds.add(st.team.coachId);
      st.team.assistantCoaches.forEach((ac) => teamCoachIds.add(ac.coachId));
    }
    const sessionCoachIds = new Set((await prisma.sessionCoach.findMany({ where: { sessionId }, select: { coachId: true } })).map((c) => c.coachId));
    const tiedToClass = !!myCoachId && (teamCoachIds.has(myCoachId) || sessionCoachIds.has(myCoachId));
    if (!isAdmin && !tiedToClass) return back("?srerr=auth");

    // The requester: the coach asking, or (admin acting) the class's head coach.
    const requestedByCoachId = myCoachId ?? [...teamCoachIds][0] ?? null;
    if (!requestedByCoachId) return back("?srerr=nocoach");

    // One open request per class.
    const existing = await prisma.subRequest.findFirst({ where: { sessionId, status: "OPEN" }, select: { id: true } });
    if (existing) {
      if (note) await prisma.subRequest.update({ where: { id: existing.id }, data: { note } });
      return back("?srok=already");
    }
    await prisma.subRequest.create({ data: { sessionId, requestedByCoachId, note, status: "OPEN" } });

    // Rally the coaches: post it so everyone sees it in the Lounge, and notify by
    // the chosen channel with a link to claim.
    const label = sessionLabel(session);
    const channels = NOTIFY_CHANNELS[notify] ?? NOTIFY_CHANNELS.INAPP;
    const requester = await prisma.coach.findUnique({ where: { id: requestedByCoachId }, select: { person: { select: { firstName: true, lastName: true } } } });
    const who = requester ? `${requester.person.firstName} ${requester.person.lastName}` : "A coach";
    await dispatchMessage({
      senderId: actor.userId, seasonId: session.seasonId,
      audienceType: "ALL_COACHES", triggerType: "SUB_REQUEST",
      channels,
      subject: "Sub needed",
      body: `${who} needs a sub: ${label}.${note ? ` Note: ${note}.` : ""} Cover it in the Coaches' Lounge: ${origin}/console/lounge`,
      smsBody: `PURE Academy — sub needed: ${label}.${note ? ` ${note}.` : ""} Cover it: ${origin}/console/lounge`,
    });
    // Also drop a card in the Lounge feed so it's visible even without a notification.
    await prisma.coachPost.create({
      data: { authorName: who, body: `🔁 Sub needed — ${label}.${note ? ` ${note}` : ""}`, notify, pinned: false },
    });

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "SUB_REQUESTED", summary: `Sub requested for ${label}` });
    return back("?srok=requested");
  }

  // --- Claim (cover) an open sub request ---
  if (op === "claim") {
    const requestId = String(fd.get("requestId") ?? "");
    if (!myCoachId) return back("?srerr=notcoach");
    const request = await prisma.subRequest.findUnique({ where: { id: requestId } });
    if (!request) return back("?srerr=notfound");
    if (request.status !== "OPEN") return back("?srerr=taken");
    if (request.requestedByCoachId === myCoachId) return back("?srerr=self");

    const session = await prisma.session.findUnique({
      where: { id: request.sessionId },
      include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } },
    });
    if (!session) return back("?srerr=notfound");

    // Don't let a coach claim a class that overlaps one they already cover.
    const clashes = await coachSessionConflicts({ coachId: myCoachId, date: session.date, startTime: session.startTime, endTime: session.endTime, excludeSessionId: session.id });
    if (clashes.length) return back("?srerr=clash");

    await assignSessionSub({ sessionId: session.id, coachId: myCoachId, role: "SUBSTITUTE", actorId: actor.userId, origin });
    await prisma.subRequest.update({ where: { id: requestId }, data: { status: "CLAIMED", claimedByCoachId: myCoachId } });

    // Tell the original coach (and admins) it's covered.
    const label = sessionLabel(session);
    const claimer = await prisma.coach.findUnique({ where: { id: myCoachId }, select: { person: { select: { firstName: true, lastName: true } } } });
    const claimerName = claimer ? `${claimer.person.firstName} ${claimer.person.lastName}` : "A coach";
    const requesterCoach = await prisma.coach.findUnique({ where: { id: request.requestedByCoachId }, select: { personId: true } });
    if (requesterCoach?.personId) {
      await dispatchMessage({
        senderId: actor.userId, seasonId: session.seasonId,
        audienceType: "SINGLE_PERSON", audienceRef: requesterCoach.personId,
        channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "SUB_CLAIMED",
        subject: "Your class is covered",
        body: `Good news — ${claimerName} is covering ${label}. You're all set.`,
        smsBody: `PURE Academy — ${claimerName} is covering ${label}. You're all set.`,
      });
    }
    await dispatchMessage({
      senderId: actor.userId, seasonId: session.seasonId,
      audienceType: "ALL_ADMINS", triggerType: "SUB_CLAIMED",
      channels: ["IN_APP"], subject: "Sub request covered",
      body: `${claimerName} is covering ${label}.`,
    });

    await audit({ actorId: actor.userId, entityType: "Session", entityId: session.id, action: "SUB_CLAIMED", summary: `${claimerName} claimed sub for ${label}` });
    return back("?srok=claimed");
  }

  // --- Cancel an open request (the requester or an admin) ---
  if (op === "cancel") {
    const requestId = String(fd.get("requestId") ?? "");
    const request = await prisma.subRequest.findUnique({ where: { id: requestId } });
    if (!request) return back("?srerr=notfound");
    if (!isAdmin && request.requestedByCoachId !== myCoachId) return back("?srerr=auth");
    if (request.status === "OPEN") {
      await prisma.subRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
    }
    await audit({ actorId: actor.userId, entityType: "SubRequest", entityId: requestId, action: "SUB_CANCELLED", summary: "Sub request cancelled" });
    return back("?srok=cancelled");
  }

  return back("?srerr=op");
}
