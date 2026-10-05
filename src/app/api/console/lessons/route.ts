import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { rescheduleLesson, cancelLesson } from "@/lib/domain/lessonManage";
import { createLessonBooking } from "@/lib/domain/lessonBooking";

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

  // Coach (or admin) books a lesson on a client's behalf — e.g. a walk-up or a
  // phone booking. Reuses the full booking engine (court hold, pricing, emails),
  // then optionally waives payment or hands back a pay link for the coach to send.
  if (op === "coachBook") {
    const offeringId = g("offeringId");
    const facilityId = g("facilityId");
    const day = g("day");
    const time = g("time");
    const firstName = g("firstName");
    const lastName = g("lastName");
    const email = g("email");
    const phone = g("phone");
    const noCharge = g("noCharge") === "1";
    if (!offeringId || !facilityId || !day || !time) return back("?lerr=badtime");
    if (!firstName || !lastName || !email) return back("?lerr=client");
    // Ownership: the offering must belong to this coach (or the actor is an admin).
    const off = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId }, select: { minPeople: true, maxPeople: true, coach: { select: { personId: true } } } });
    if (!off) return back("?lerr=notfound");
    if (!admin && off.coach?.personId !== actorCtx.personId) return back("?lerr=auth");
    // Headcount, clamped to the offering's group size (pricing scales with it).
    const peopleRaw = parseInt(g("people"), 10);
    const people = Math.min(off.maxPeople ?? 1, Math.max(off.minPeople ?? 1, Number.isFinite(peopleRaw) ? peopleRaw : (off.minPeople ?? 1)));
    const res = await createLessonBooking({
      offeringId, facilityId, startDay: day, startTime: time, people,
      cadence: "ONCE", intervalN: 1, endType: "ONCE",
      client: { firstName, lastName, email, phone: phone || undefined },
    });
    if (!res.ok) return back(`?lerr=${encodeURIComponent(res.error || "failed")}`);
    if (noCharge && res.firstPaymentId) {
      const pay = await prisma.payment.findUnique({ where: { id: res.firstPaymentId }, select: { id: true } });
      if (pay) {
        await prisma.payment.update({ where: { id: pay.id }, data: { status: "WAIVED" } });
        await prisma.alaCarteBooking.updateMany({ where: { paymentId: pay.id }, data: { status: "ACCEPTED" } });
      }
      return back("?lok=coachbooked");
    }
    return back(`?lok=coachbooked${res.firstPaymentId ? `&pay=${res.firstPaymentId}` : ""}`);
  }

  // Coach blocks a slot (lunch, travel, personal time) so players can't book it.
  if (op === "blockTime") {
    const day = g("day");
    const startTime = g("startTime");
    const endTime = g("endTime");
    const note = g("note");
    if (!actorCtx.personId) return back("?lerr=noperson");
    const coach = await prisma.coach.findUnique({ where: { personId: actorCtx.personId }, select: { id: true } });
    if (!coach) return back("?lerr=auth");
    if (!day) return back("?lerr=badtime");
    const wholeDay = !startTime || !endTime;
    await prisma.availabilityException.create({
      data: {
        coachId: coach.id, date: new Date(`${day}T12:00:00Z`),
        startTime: wholeDay ? null : startTime, endTime: wholeDay ? null : endTime,
        kind: "BLOCK", note: note || null,
      },
    });
    return back("?lok=blocked");
  }

  if (op === "unblock") {
    const exId = g("exceptionId");
    if (!actorCtx.personId) return back("?lerr=noperson");
    const coach = await prisma.coach.findUnique({ where: { personId: actorCtx.personId }, select: { id: true } });
    if (!coach || !exId) return back("?lerr=notfound");
    await prisma.availabilityException.deleteMany({ where: { id: exId, coachId: coach.id } });
    return back("?lok=unblocked");
  }

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
