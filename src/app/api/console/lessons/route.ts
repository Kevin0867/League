import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { rescheduleLesson, cancelLesson } from "@/lib/domain/lessonManage";

// Manage a booked lesson (Phase 5): reschedule/relocate or cancel. A coach may
// act on their OWN lessons; an admin on any (and only an admin can refund). The
// ownership + notification rules live in lessonManage; this route resolves the
// actor and returns to the right surface with a result flag.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const admin = isAdmin(actor.roles ?? [actor.role]);
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const actorCtx = { userId: actor.userId, personId: me?.personId ?? null, isAdmin: admin };

  // Where to return: admins to the admin lessons console, coaches to their own.
  const returnBase = g("returnTo") || (admin ? "/console/alacarte" : "/console/profile/lessons/schedule");
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  const op = g("op");
  const bookingId = g("bookingId");
  if (!bookingId) return back("?lerr=notfound");

  if (op === "reschedule") {
    const res = await rescheduleLesson({ bookingId, day: g("day"), time: g("time"), facilityId: g("facilityId") || null, actor: actorCtx });
    if (!res.ok) return back(`?lerr=${encodeURIComponent(res.detail || res.error || "failed")}`);
    return back("?lok=moved");
  }

  if (op === "cancel") {
    const res = await cancelLesson({ bookingId, refund: g("refund") === "1", reason: g("reason") || undefined, actor: actorCtx });
    if (!res.ok) return back(`?lerr=${encodeURIComponent(res.error || "failed")}`);
    return back(`?lok=cancelled${res.refundedCents ? `&rc=${res.refundedCents}` : ""}`);
  }

  return back("?lerr=op");
}
