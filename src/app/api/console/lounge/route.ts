import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isStaff, isAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { STAFF_ROLES } from "@/lib/enums";
import { appUrl } from "@/lib/stripe";

// Coaches' Lounge — staff-only board actions: post, reply, pin, delete. The
// poster picks how staff are notified: NONE (just posts), INAPP (a console-inbox
// notification), EMAIL, or TEXT. Players/parents can never reach this route —
// it's gated to staff (coach + admin).
export const dynamic = "force-dynamic";

const NOTIFY = new Set(["NONE", "INAPP", "EMAIL", "TEXT"]);

/** Notify every OTHER staff member per the chosen level. */
async function notifyStaff(level: string, authorPersonId: string | null, authorName: string, body: string) {
  if (level === "NONE") return;
  const channels =
    level === "TEXT" ? (["IN_APP", "EMAIL", "SMS"] as const)
    : level === "EMAIL" ? (["IN_APP", "EMAIL"] as const)
    : (["IN_APP"] as const);

  const staff = await prisma.user.findMany({
    where: {
      active: true,
      personId: { not: null },
      OR: [{ role: { in: STAFF_ROLES } }, { extraRoles: { hasSome: STAFF_ROLES } }],
    },
    select: { personId: true },
  });
  const link = `${appUrl()}/console/lounge`;
  const subject = `Coaches' Lounge — ${authorName}`;
  const text = `${authorName} posted in the Coaches' Lounge:\n\n${body}\n\nOpen the lounge: ${link}`;
  const sms = `PURE Coaches' Lounge — ${authorName}: ${body}`.slice(0, 320);

  for (const s of staff) {
    if (!s.personId || s.personId === authorPersonId) continue;
    try {
      await dispatchMessage({
        seasonId: null,
        audienceType: "SINGLE_PERSON",
        audienceRef: s.personId,
        channels: [...channels],
        triggerType: "COACH_BOARD",
        subject,
        body: text,
        smsBody: sms,
      });
    } catch (e) {
      console.error("lounge notify failed", e);
    }
  }
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/lounge${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !isStaff(actor.roles ?? [actor.role])) return back("?err=auth");
  const admin = isAdmin(actor.roles ?? [actor.role]);

  const me = await prisma.user.findUnique({ where: { id: actor.userId }, include: { person: { select: { firstName: true, lastName: true } } } });
  const myPersonId = me?.personId ?? null;
  const myName = me?.person ? `${me.person.firstName} ${me.person.lastName}` : "A coach";

  const op = String(fd.get("op") ?? "");

  if (op === "post") {
    const body = String(fd.get("body") ?? "").trim().slice(0, 4000);
    if (!body) return back("?err=empty");
    const notify = NOTIFY.has(String(fd.get("notify") ?? "")) ? String(fd.get("notify")) : "INAPP";
    const pinned = admin && fd.get("pinned") === "on";
    const post = await prisma.coachPost.create({ data: { authorPersonId: myPersonId, authorName: myName, body, notify, pinned } });
    await audit({ actorId: actor.userId, entityType: "CoachPost", entityId: post.id, action: "CREATE", summary: `Lounge post (${notify})` });
    await notifyStaff(notify, myPersonId, myName, body);
    return back("?ok=posted");
  }

  if (op === "reply") {
    const postId = String(fd.get("postId") ?? "");
    const body = String(fd.get("body") ?? "").trim().slice(0, 4000);
    if (!postId || !body) return back("?err=empty");
    const post = await prisma.coachPost.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return back("?err=notfound");
    await prisma.coachReply.create({ data: { postId, authorPersonId: myPersonId, authorName: myName, body } });
    await audit({ actorId: actor.userId, entityType: "CoachPost", entityId: postId, action: "REPLY", summary: "Lounge reply" });
    return back("?ok=replied");
  }

  if (op === "pin" || op === "unpin") {
    if (!admin) return back("?err=auth");
    const postId = String(fd.get("postId") ?? "");
    if (!postId) return back("?err=notfound");
    await prisma.coachPost.update({ where: { id: postId }, data: { pinned: op === "pin" } });
    return back(op === "pin" ? "?ok=pinned" : "?ok=unpinned");
  }

  if (op === "deletePost") {
    const postId = String(fd.get("postId") ?? "");
    if (!postId) return back("?err=notfound");
    const post = await prisma.coachPost.findUnique({ where: { id: postId }, select: { authorPersonId: true } });
    if (!post) return back("?err=notfound");
    // Author or admin may delete.
    if (!admin && post.authorPersonId !== myPersonId) return back("?err=auth");
    await prisma.coachPost.delete({ where: { id: postId } }); // replies cascade
    await audit({ actorId: actor.userId, entityType: "CoachPost", entityId: postId, action: "DELETE", summary: "Deleted lounge post" });
    return back("?ok=deleted");
  }

  if (op === "deleteReply") {
    const replyId = String(fd.get("replyId") ?? "");
    if (!replyId) return back("?err=notfound");
    const reply = await prisma.coachReply.findUnique({ where: { id: replyId }, select: { authorPersonId: true } });
    if (!reply) return back("?err=notfound");
    if (!admin && reply.authorPersonId !== myPersonId) return back("?err=auth");
    await prisma.coachReply.delete({ where: { id: replyId } });
    return back("?ok=deleted");
  }

  return back("?err=op");
}
