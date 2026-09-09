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

    // Rally everyone: a sub request always TEXTS both coaches and admins (plus
    // in-app + email), since covering a class is time-sensitive.
    const label = sessionLabel(session);
    const requester = await prisma.coach.findUnique({ where: { id: requestedByCoachId }, select: { person: { select: { firstName: true, lastName: true } } } });
    const who = requester ? `${requester.person.firstName} ${requester.person.lastName}` : "A coach";
    const body = `${who} needs a sub: ${label}.${note ? ` Note: ${note}.` : ""} Cover it in the Coaches' Lounge: ${origin}/console/lounge`;
    const smsBody = `PURE Academy — sub needed: ${label}.${note ? ` ${note}.` : ""} Cover it: ${origin}/console/lounge`;
    for (const audienceType of ["ALL_COACHES", "ALL_ADMINS"] as const) {
      await dispatchMessage({
        senderId: actor.userId, seasonId: session.seasonId,
        audienceType, triggerType: "SUB_REQUEST",
        channels: ["IN_APP", "EMAIL", "SMS"],
        subject: "Sub needed", body, smsBody,
      });
    }
    // Also drop a card in the Lounge feed so it's visible even without a notification.
    await prisma.coachPost.create({
      data: { authorName: who, body: `🔁 Sub needed — ${label}.${note ? ` ${note}` : ""}`, notify: "TEXT", pinned: false },
    });

    await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "SUB_REQUESTED", summary: `Sub requested for ${label}` });
    return back("?srok=requested");
  }

  // --- Offer to cover an open request (coach). This does NOT assign the sub —
  //     it goes to admins for approval first. ---
  if (op === "claim") {
    const requestId = String(fd.get("requestId") ?? "");
    if (!myCoachId) return back("?srerr=notcoach");
    const request = await prisma.subRequest.findUnique({ where: { id: requestId } });
    if (!request) return back("?srerr=notfound");
    if (request.status === "PENDING") return back("?srerr=pending");
    if (request.status !== "OPEN") return back("?srerr=taken");
    if (request.requestedByCoachId === myCoachId) return back("?srerr=self");

    const session = await prisma.session.findUnique({
      where: { id: request.sessionId },
      include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } },
    });
    if (!session) return back("?srerr=notfound");
    // Don't let a coach offer for a class that overlaps one they already cover.
    const clashes = await coachSessionConflicts({ coachId: myCoachId, date: session.date, startTime: session.startTime, endTime: session.endTime, excludeSessionId: session.id });
    if (clashes.length) return back("?srerr=clash");

    // Record the offer — awaiting admin approval. Nothing is assigned yet.
    await prisma.subRequest.update({ where: { id: requestId }, data: { status: "PENDING", claimedByCoachId: myCoachId } });

    const label = sessionLabel(session);
    const offerer = await prisma.coach.findUnique({ where: { id: myCoachId }, select: { person: { select: { firstName: true, lastName: true } } } });
    const offererName = offerer ? `${offerer.person.firstName} ${offerer.person.lastName}` : "A coach";
    // Admins approve — text + email + in-app so they can action it fast.
    await dispatchMessage({
      senderId: actor.userId, seasonId: session.seasonId,
      audienceType: "ALL_ADMINS", triggerType: "SUB_OFFER",
      channels: ["IN_APP", "EMAIL", "SMS"],
      subject: "Sub offer needs approval",
      body: `${offererName} offered to cover ${label}. Approve it in the Coaches' Lounge: ${origin}/console/lounge`,
      smsBody: `PURE Academy — ${offererName} offered to cover ${label}. Approve: ${origin}/console/lounge`,
    });
    // Let the requester know someone stepped up (pending approval).
    const reqCoach = await prisma.coach.findUnique({ where: { id: request.requestedByCoachId }, select: { personId: true } });
    if (reqCoach?.personId) {
      await dispatchMessage({
        senderId: actor.userId, seasonId: session.seasonId,
        audienceType: "SINGLE_PERSON", audienceRef: reqCoach.personId,
        channels: ["IN_APP"], triggerType: "SUB_OFFER",
        subject: "A coach offered to cover", body: `${offererName} offered to cover ${label} — an admin will confirm it.`,
      });
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: session.id, action: "SUB_OFFERED", summary: `${offererName} offered to cover ${label} (pending approval)` });
    return back("?srok=offered");
  }

  // --- Approve a pending offer (admin only). This is what actually assigns the
  //     substitute and puts it in place. ---
  if (op === "approve") {
    if (!isAdmin) return back("?srerr=auth");
    const requestId = String(fd.get("requestId") ?? "");
    const request = await prisma.subRequest.findUnique({ where: { id: requestId } });
    if (!request) return back("?srerr=notfound");
    if (request.status !== "PENDING" || !request.claimedByCoachId) return back("?srerr=notpending");

    const session = await prisma.session.findUnique({
      where: { id: request.sessionId },
      include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } },
    });
    if (!session) return back("?srerr=notfound");
    const coverCoachId = request.claimedByCoachId;

    await assignSessionSub({ sessionId: session.id, coachId: coverCoachId, role: "SUBSTITUTE", actorId: actor.userId, origin });
    await prisma.subRequest.update({ where: { id: requestId }, data: { status: "APPROVED" } });

    const label = sessionLabel(session);
    const cover = await prisma.coach.findUnique({ where: { id: coverCoachId }, select: { personId: true, person: { select: { firstName: true, lastName: true } } } });
    const coverName = cover ? `${cover.person.firstName} ${cover.person.lastName}` : "A coach";
    // assignSessionSub already texts/emails the covering coach the class details.
    const reqCoach = await prisma.coach.findUnique({ where: { id: request.requestedByCoachId }, select: { personId: true } });
    if (reqCoach?.personId) {
      await dispatchMessage({
        senderId: actor.userId, seasonId: session.seasonId,
        audienceType: "SINGLE_PERSON", audienceRef: reqCoach.personId,
        channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "SUB_APPROVED",
        subject: "Your class is covered",
        body: `Approved — ${coverName} is covering ${label}. You're all set.`,
        smsBody: `PURE Academy — ${coverName} is covering ${label}. You're all set.`,
      });
    }
    await audit({ actorId: actor.userId, entityType: "Session", entityId: session.id, action: "SUB_APPROVED", summary: `Approved ${coverName} to cover ${label}` });
    return back("?srok=approved");
  }

  // --- Decline a pending offer (admin only) — reopens the request for others. ---
  if (op === "decline") {
    if (!isAdmin) return back("?srerr=auth");
    const requestId = String(fd.get("requestId") ?? "");
    const request = await prisma.subRequest.findUnique({ where: { id: requestId } });
    if (!request) return back("?srerr=notfound");
    if (request.status !== "PENDING") return back("?srerr=notpending");
    const declinedCoachId = request.claimedByCoachId;
    await prisma.subRequest.update({ where: { id: requestId }, data: { status: "OPEN", claimedByCoachId: null } });

    const session = await prisma.session.findUnique({
      where: { id: request.sessionId },
      include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } },
    });
    const label = session ? sessionLabel(session) : "the class";
    if (declinedCoachId) {
      const dc = await prisma.coach.findUnique({ where: { id: declinedCoachId }, select: { personId: true } });
      if (dc?.personId && session) {
        await dispatchMessage({
          senderId: actor.userId, seasonId: session.seasonId,
          audienceType: "SINGLE_PERSON", audienceRef: dc.personId,
          channels: ["IN_APP", "SMS"], triggerType: "SUB_DECLINED",
          subject: "Sub offer not approved",
          body: `Thanks for offering to cover ${label} — it wasn't approved this time. The request is still open.`,
          smsBody: `PURE Academy — your offer to cover ${label} wasn't approved this time.`,
        });
      }
    }
    await audit({ actorId: actor.userId, entityType: "SubRequest", entityId: requestId, action: "SUB_DECLINED", summary: `Declined offer for ${label}` });
    return back("?srok=declined");
  }

  // --- Cancel a request (the requester or an admin) — while OPEN or PENDING. ---
  if (op === "cancel") {
    const requestId = String(fd.get("requestId") ?? "");
    const request = await prisma.subRequest.findUnique({ where: { id: requestId } });
    if (!request) return back("?srerr=notfound");
    if (!isAdmin && request.requestedByCoachId !== myCoachId) return back("?srerr=auth");
    if (request.status === "OPEN" || request.status === "PENDING") {
      await prisma.subRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
    }
    await audit({ actorId: actor.userId, entityType: "SubRequest", entityId: requestId, action: "SUB_CANCELLED", summary: "Sub request cancelled" });
    return back("?srok=cancelled");
  }

  return back("?srerr=op");
}
