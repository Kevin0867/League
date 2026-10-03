import "server-only";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { syncRefundsForCharge } from "@/lib/payments/refunds";
import { isCourtTimeFree, createCourtHold, releaseCourtHolds, addMinutesHHMM } from "@/lib/domain/courtHold";
import { coachBusyAt } from "@/lib/domain/lessonBooking";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12, phoenixDateInput } from "@/lib/time";
import { phoenixHHMM } from "@/lib/domain/courtHold";

// Phase 5 — editing a booked lesson. A coach can move the date/time/location of
// one of their lessons (admins are always notified); an admin can move or cancel
// any lesson, with an optional refund. Moving a lesson re-checks the slot and
// moves the court hold so the conflict model stays correct; cancelling releases
// the hold and (optionally) refunds through the same Stripe path the rest of the
// app uses.

type Actor = { userId: string; personId: string | null; isAdmin: boolean };

function whenLabel(scheduledAt: Date): string {
  const day = phoenixDateInput(scheduledAt);
  return `${formatDate(new Date(`${day}T12:00:00Z`))} at ${formatTime12(phoenixHHMM(scheduledAt))}`;
}

async function loadBooking(bookingId: string) {
  return prisma.alaCarteBooking.findUnique({
    where: { id: bookingId },
    include: {
      offering: { select: { title: true, lengthMin: true } },
      coach: { select: { id: true, personId: true, person: { select: { id: true, firstName: true, lastName: true } } } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

/** May this actor manage this lesson? Admins: any. Coaches: only their own. */
function canManage(actor: Actor, coachPersonId: string | null | undefined): boolean {
  if (actor.isAdmin) return true;
  return !!actor.personId && actor.personId === coachPersonId;
}

export type ManageResult = { ok: boolean; error?: string; detail?: string };

/** Move a lesson to a new day/time and/or location. Re-checks the slot, moves
 *  the court hold, and notifies the client + admins (+ the coach if an admin
 *  made the change). */
export async function rescheduleLesson(opts: {
  bookingId: string; day: string; time: string; facilityId?: string | null; actor: Actor;
}): Promise<ManageResult> {
  const b = await loadBooking(opts.bookingId);
  if (!b) return { ok: false, error: "notfound" };
  if (b.status === "CANCELLED" || b.status === "DECLINED") return { ok: false, error: "cancelled" };
  if (!canManage(opts.actor, b.coach?.personId)) return { ok: false, error: "auth" };

  const facilityId = (opts.facilityId && opts.facilityId.trim()) || b.facilityId;
  if (!facilityId) return { ok: false, error: "nofacility" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.day) || !/^\d{1,2}:\d{2}$/.test(opts.time)) return { ok: false, error: "badtime" };

  const lengthMin = b.lessonLengthMin ?? b.offering?.lengthMin ?? 60;
  const end = addMinutesHHMM(opts.time, lengthMin);

  // Re-check the slot, ignoring this lesson's own current hold/booking.
  const courtFree = await isCourtTimeFree(facilityId, opts.day, opts.time, end, 1, b.id);
  if (!courtFree.ok) return { ok: false, error: "conflict", detail: courtFree.reason };
  if (b.coach?.id && (await coachBusyAt(b.coach.id, opts.day, opts.time, end, b.id))) {
    return { ok: false, error: "conflict", detail: "coach is busy then" };
  }

  const prevWhen = b.scheduledAt ? whenLabel(b.scheduledAt) : "its previous time";
  const prevFacilityId = b.facilityId;
  const scheduledAt = phoenixWallTimeToUtc(new Date(`${opts.day}T12:00:00Z`), opts.time);

  // Move the hold, then the booking. Reset the reminder marker so the "today"
  // reminder re-fires for the new time.
  await releaseCourtHolds("LESSON", b.id);
  await createCourtHold({ facilityId, day: opts.day, startTime: opts.time, endTime: end, refType: "LESSON", refId: b.id, note: `Lesson — ${b.client.firstName} ${b.client.lastName}` });
  await prisma.alaCarteBooking.update({ where: { id: b.id }, data: { scheduledAt, facilityId, reminderSentAt: null } });

  const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } });
  const relocated = prevFacilityId && prevFacilityId !== facilityId;
  const newWhen = whenLabel(scheduledAt);
  const what = b.offering?.title || "lesson";
  const where = facility?.name ? ` at ${facility.name}` : "";

  // Client: always told.
  await dispatchMessage({
    senderId: opts.actor.userId, audienceType: "SINGLE_PERSON", audienceRef: b.client.id, channels: ["EMAIL", "SMS"],
    triggerType: "LESSON_RESCHEDULED", subject: "Your PURE Academy lesson was updated",
    body: `Your ${what} has been moved${relocated ? " and relocated" : ""} to ${newWhen}${where} (was ${prevWhen}). Your court is reserved for the new time. Questions? Just reply.`,
    smsBody: `PURE Academy — your ${what} is now ${newWhen}${where} (was ${prevWhen}). Your court is reserved.`,
  }).catch(() => {});

  // Admins: always notified of a change (the coach can move it, but staff must know).
  const coachName = b.coach ? `${b.coach.person.firstName} ${b.coach.person.lastName}`.trim() : "a coach";
  const mover = opts.actor.isAdmin ? "An admin" : coachName;
  await dispatchMessage({
    senderId: opts.actor.userId, audienceType: "ALL_ADMINS", channels: ["IN_APP", "EMAIL"],
    triggerType: "LESSON_RESCHEDULED", subject: "A lesson was rescheduled",
    body: `${mover} moved ${b.client.firstName} ${b.client.lastName}'s ${what} with ${coachName} to ${newWhen}${where} (was ${prevWhen}).`,
  }).catch(() => {});

  // If an admin moved it, let the coach know too.
  if (opts.actor.isAdmin && b.coach?.person?.id) {
    await dispatchMessage({
      senderId: opts.actor.userId, audienceType: "SINGLE_PERSON", audienceRef: b.coach.person.id, channels: ["IN_APP", "SMS"],
      triggerType: "LESSON_RESCHEDULED", subject: "A lesson was rescheduled",
      body: `${b.client.firstName} ${b.client.lastName}'s ${what} was moved to ${newWhen}${where} (was ${prevWhen}).`,
    }).catch(() => {});
  }

  await audit({ actorId: opts.actor.userId, entityType: "AlaCarteBooking", entityId: b.id, action: "LESSON_RESCHEDULED", summary: `Lesson moved to ${newWhen}${where} (was ${prevWhen})` });
  return { ok: true };
}

/** Cancel a lesson: release the court hold, mark it cancelled, optionally refund
 *  the card, and notify the client + admins (+ coach). */
export async function cancelLesson(opts: {
  bookingId: string; refund: boolean; reason?: string; actor: Actor;
}): Promise<ManageResult & { refundedCents?: number }> {
  const b = await loadBooking(opts.bookingId);
  if (!b) return { ok: false, error: "notfound" };
  if (b.status === "CANCELLED" || b.status === "DECLINED") return { ok: false, error: "cancelled" };
  if (!canManage(opts.actor, b.coach?.personId)) return { ok: false, error: "auth" };
  // Only an admin can issue a refund.
  const doRefund = opts.refund && opts.actor.isAdmin;

  await releaseCourtHolds("LESSON", b.id);
  await prisma.alaCarteBooking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });

  let refundedCents = 0;
  if (doRefund && b.paymentId) {
    refundedCents = await refundLessonPayment(b.paymentId, opts.reason || "Lesson cancelled", opts.actor.userId).catch((e) => {
      console.error("lesson refund failed", e);
      return 0;
    });
  }

  // If the whole series now has nothing active left, close it out.
  if (b.seriesId) {
    const remaining = await prisma.alaCarteBooking.count({ where: { seriesId: b.seriesId, status: { notIn: ["CANCELLED", "DECLINED"] } } });
    if (remaining === 0) await prisma.lessonSeries.update({ where: { id: b.seriesId }, data: { status: "CANCELLED" } }).catch(() => {});
  }

  const what = b.offering?.title || "lesson";
  const whenStr = b.scheduledAt ? whenLabel(b.scheduledAt) : "your scheduled time";
  const refundLine = refundedCents > 0 ? ` A refund of ${formatCents(refundedCents)} is on its way to your card.` : "";
  await dispatchMessage({
    senderId: opts.actor.userId, audienceType: "SINGLE_PERSON", audienceRef: b.client.id, channels: ["EMAIL", "SMS"],
    triggerType: "LESSON_CANCELLED", subject: "Your PURE Academy lesson was cancelled",
    body: `Your ${what} on ${whenStr} has been cancelled.${refundLine} Questions? Just reply and we'll help.`,
    smsBody: `PURE Academy — your ${what} on ${whenStr} was cancelled.${refundLine}`,
  }).catch(() => {});

  const coachName = b.coach ? `${b.coach.person.firstName} ${b.coach.person.lastName}`.trim() : "a coach";
  const who = opts.actor.isAdmin ? "An admin" : coachName;
  await dispatchMessage({
    senderId: opts.actor.userId, audienceType: "ALL_ADMINS", channels: ["IN_APP", "EMAIL"],
    triggerType: "LESSON_CANCELLED", subject: "A lesson was cancelled",
    body: `${who} cancelled ${b.client.firstName} ${b.client.lastName}'s ${what} with ${coachName} on ${whenStr}.${refundedCents > 0 ? ` Refunded ${formatCents(refundedCents)}.` : ""}`,
  }).catch(() => {});

  if (opts.actor.isAdmin && b.coach?.person?.id) {
    await dispatchMessage({
      senderId: opts.actor.userId, audienceType: "SINGLE_PERSON", audienceRef: b.coach.person.id, channels: ["IN_APP"],
      triggerType: "LESSON_CANCELLED", subject: "A lesson was cancelled",
      body: `${b.client.firstName} ${b.client.lastName}'s ${what} on ${whenStr} was cancelled.`,
    }).catch(() => {});
  }

  await audit({ actorId: opts.actor.userId, entityType: "AlaCarteBooking", entityId: b.id, action: "LESSON_CANCELLED", summary: `Lesson cancelled${refundedCents > 0 ? ` — refunded ${formatCents(refundedCents)}` : ""}` });
  return { ok: true, refundedCents };
}

/** Refund a single lesson's payment in full, booking the OUT/REFUND ledger row.
 *  Returns the cents refunded (0 if nothing to refund). Idempotent per charge. */
async function refundLessonPayment(paymentId: string, reason: string, actorId: string): Promise<number> {
  const pay = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, partyId: true, seasonId: true, amountCents: true, status: true, description: true, stripePaymentIntentId: true },
  });
  if (!pay) return 0;
  if (pay.status !== "PAID") return 0; // nothing charged yet → nothing to refund

  const original = { id: pay.id, partyId: pay.partyId, seasonId: pay.seasonId, amountCents: pay.amountCents, status: pay.status, description: `${pay.description ?? "lesson"} — ${reason}` };

  if (!isStripeConfigured() || !pay.stripePaymentIntentId) {
    // Dev / no card on file: book a simulated OUT row so the ledger reflects it.
    await prisma.payment.create({
      data: { direction: "OUT", partyId: pay.partyId, amountCents: pay.amountCents, method: "STRIPE", status: "PAID", category: "REFUND", seasonId: pay.seasonId, paidAt: new Date(), description: `Refund — ${original.description} [simulated]` },
    });
    await prisma.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED" } });
    return pay.amountCents;
  }

  const pi = await stripe().paymentIntents.retrieve(pay.stripePaymentIntentId);
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
  if (!chargeId) return 0;
  await stripe().refunds.create(
    { charge: chargeId, metadata: { paymentId: pay.id, reason: reason.slice(0, 200) } },
    { idempotencyKey: `lessonrefund:${pay.id}:${chargeId}` },
  );
  const fresh = await stripe().charges.retrieve(chargeId);
  await syncRefundsForCharge(original, fresh.id, fresh.amount, fresh.amount_refunded);
  void actorId;
  return fresh.amount_refunded || pay.amountCents;
}
