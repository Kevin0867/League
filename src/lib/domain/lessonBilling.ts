import "server-only";
import { prisma } from "@/lib/db";
import { stripe, isStripeConfigured, appUrl } from "@/lib/stripe";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { notifyAdminsPaymentFailed } from "@/lib/payments/adminAlert";
import { lessonPaymentEmail } from "@/lib/payments/lessonPaymentEmail";
import { releaseCourtHolds, phoenixHHMM } from "@/lib/domain/courtHold";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12, phoenixDateInput } from "@/lib/time";

// Phase 4 — per-lesson billing. A lesson series pays per lesson: the first is
// charged at booking (normal hosted checkout, which also SAVES the card for a
// recurring series), and every later lesson is auto-charged off-session on the
// saved card shortly before it happens. On a decline (or when no card was
// saved) we fall back to emailing the player a pay link and alerting staff. This
// module also sends the "your lesson is today" reminder and releases the court
// held by a booking whose first lesson was never paid.

/** How long before a lesson we attempt the off-session charge / pay-link. */
const CHARGE_LEAD_MS = 48 * 60 * 60 * 1000;
/** Fire the "lesson today" reminder when the start is within this window. */
const REMIND_LEAD_MIN = 135; // ~2¼h before
const REMIND_GRACE_MIN = 10; // still send if the run is a touch late
/** A booking whose first lesson is never paid holds a court — release after this. */
const ABANDON_GRACE_MS = 2 * 60 * 60 * 1000;

function whenLabel(scheduledAt: Date): string {
  const day = phoenixDateInput(scheduledAt);
  return `${formatDate(new Date(`${day}T12:00:00Z`))} at ${formatTime12(phoenixHHMM(scheduledAt))}`;
}

/**
 * Called when a lesson's Payment clears (first-lesson checkout webhook, or a
 * successful auto-charge). Confirms the occurrence, sends the player a
 * lesson-appropriate confirmation, and — for a recurring series whose card isn't
 * saved yet — captures the Stripe customer + payment method from the
 * PaymentIntent so later lessons can be charged off-session.
 *
 * Returns whether this was a lesson payment, so the webhook can skip the generic
 * season-fee "you're enrolled" receipt for lessons.
 */
export async function confirmLessonPaid(
  paymentId: string,
  stripeRefs?: { paymentIntentId?: string | null; customerId?: string | null },
): Promise<{ wasLesson: boolean }> {
  const booking = await prisma.alaCarteBooking.findFirst({
    where: { paymentId },
    include: {
      offering: { select: { title: true } },
      coach: { select: { person: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!booking) return { wasLesson: false };

  const firstConfirm = booking.status !== "ACCEPTED" && booking.status !== "DELIVERED";
  if (firstConfirm) {
    await prisma.alaCarteBooking.update({ where: { id: booking.id }, data: { status: "ACCEPTED" } });
    // Lesson-specific confirmation to the player (not the season "enrolled" copy).
    const facility = booking.facilityId ? await prisma.facility.findUnique({ where: { id: booking.facilityId }, select: { name: true } }) : null;
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { amountCents: true } });
    const coachName = booking.coach ? `${booking.coach.person.firstName} ${booking.coach.person.lastName}`.trim() : null;
    const where = facility?.name ? ` at ${facility.name}` : "";
    const whenStr = booking.scheduledAt ? whenLabel(booking.scheduledAt) : null;
    const amount = payment ? formatCents(payment.amountCents) : null;
    const what = booking.offering?.title || "lesson";
    await dispatchMessage({
      audienceType: "SINGLE_PERSON", audienceRef: booking.clientId, channels: ["EMAIL", "SMS"],
      triggerType: "LESSON_CONFIRMED", subject: "Your PURE Academy lesson is booked",
      body: `Your ${what}${coachName ? ` with ${coachName}` : ""} is confirmed${whenStr ? ` for ${whenStr}` : ""}${where}.${amount ? ` Payment of ${amount} received.` : ""} Your court is reserved. See you on the court!`,
      smsBody: `PURE Academy — your ${what}${whenStr ? ` on ${whenStr}` : ""}${where} is booked and your court is reserved. See you there!`,
    }).catch(() => {});
  }

  if (!booking.seriesId) return { wasLesson: true };

  const ser = await prisma.lessonSeries.findUnique({
    where: { id: booking.seriesId },
    select: { cadence: true, stripeCustomerId: true, defaultPaymentMethodId: true },
  });
  if (!ser || ser.cadence === "ONCE") return { wasLesson: true };
  if (ser.stripeCustomerId && ser.defaultPaymentMethodId) return { wasLesson: true }; // already on file

  let customerId = stripeRefs?.customerId ?? null;
  let pmId: string | null = null;
  if (stripeRefs?.paymentIntentId && isStripeConfigured()) {
    try {
      const pi = await stripe().paymentIntents.retrieve(stripeRefs.paymentIntentId);
      if (typeof pi.customer === "string") customerId = pi.customer;
      if (typeof pi.payment_method === "string") pmId = pi.payment_method;
    } catch (e) {
      console.error("lesson PI retrieve failed", e);
    }
  }
  if (customerId || pmId) {
    await prisma.lessonSeries.update({
      where: { id: booking.seriesId },
      data: { ...(customerId ? { stripeCustomerId: customerId } : {}), ...(pmId ? { defaultPaymentMethodId: pmId } : {}) },
    });
  }
  return { wasLesson: true };
}

/** Email the player a pay link for one lesson and mark it sent. */
async function sendLessonPayLink(booking: {
  id: string;
  clientId: string;
  payment: { id: string; amountCents: number };
  offering: { title: string | null } | null;
  coach: { person: { firstName: string; lastName: string } } | null;
  facilityName: string | null;
  scheduledAt: Date | null;
}): Promise<void> {
  const client = await prisma.person.findUnique({ where: { id: booking.clientId }, select: { firstName: true, email: true } });
  if (client?.email) {
    const mail = lessonPaymentEmail({
      name: client.firstName || "there",
      amountCents: booking.payment.amountCents,
      paymentId: booking.payment.id,
      lessonTitle: booking.offering?.title || "Lesson",
      coachName: booking.coach ? `${booking.coach.person.firstName} ${booking.coach.person.lastName}`.trim() : null,
      facilityName: booking.facilityName || "PURE Academy",
      when: booking.scheduledAt ? whenLabel(booking.scheduledAt) : null,
    });
    await dispatchMessage({
      audienceType: "SINGLE_PERSON", audienceRef: booking.clientId, channels: ["EMAIL"],
      triggerType: "LESSON_PAYMENT_DUE", subject: mail.subject, body: mail.text, html: mail.html,
    }).catch(() => {});
  }
  await prisma.alaCarteBooking.update({ where: { id: booking.id }, data: { payLinkSentAt: new Date() } });
}

/**
 * Charge the saved card for each later lesson coming up within the lead window.
 * First lessons are paid at booking, so this only targets recurring occurrences
 * (seriesId set, still REQUESTED, no pay link sent yet). Returns run counters.
 */
export async function chargeUpcomingLessons(now: Date): Promise<{ scanned: number; charged: number; declined: number; payLinked: number }> {
  const horizon = new Date(now.getTime() + CHARGE_LEAD_MS);
  const candidates = await prisma.alaCarteBooking.findMany({
    where: {
      seriesId: { not: null },
      status: "REQUESTED",
      payLinkSentAt: null,
      scheduledAt: { gt: now, lte: horizon },
      paymentId: { not: null },
    },
    include: {
      offering: { select: { title: true } },
      coach: { select: { person: { select: { id: true, firstName: true, lastName: true } } } },
      series: { select: { id: true, stripeCustomerId: true, defaultPaymentMethodId: true } },
    },
    take: 100,
  });

  // AlaCarteBooking carries only a paymentId (no relation), so load the still-owed
  // payments in one query and keep only bookings whose charge is actually due.
  const payIds = candidates.map((c) => c.paymentId!).filter(Boolean);
  const payments = payIds.length
    ? await prisma.payment.findMany({ where: { id: { in: payIds }, status: "REQUESTED", direction: "IN" }, select: { id: true, amountCents: true, description: true } })
    : [];
  const payById = new Map(payments.map((p) => [p.id, p]));
  const due = candidates.filter((b) => b.series && b.paymentId && payById.has(b.paymentId));

  let charged = 0, declined = 0, payLinked = 0;
  for (const b of due) {
    const payment = payById.get(b.paymentId!)!;
    if (!b.series) continue;
    const facility = b.facilityId ? await prisma.facility.findUnique({ where: { id: b.facilityId }, select: { name: true } }) : null;
    const facilityName = facility?.name ?? null;
    const coachName = b.coach ? `${b.coach.person.firstName} ${b.coach.person.lastName}`.trim() : null;

    const canCharge = isStripeConfigured() && !!b.series.stripeCustomerId && !!b.series.defaultPaymentMethodId;
    if (!canCharge) {
      // No saved card to charge — email a pay link instead (once).
      await sendLessonPayLink({ id: b.id, clientId: b.clientId, payment, offering: b.offering, coach: b.coach, facilityName, scheduledAt: b.scheduledAt });
      payLinked++;
      continue;
    }

    try {
      const pi = await stripe().paymentIntents.create(
        {
          amount: payment.amountCents,
          currency: "usd",
          customer: b.series.stripeCustomerId!,
          payment_method: b.series.defaultPaymentMethodId!,
          off_session: true,
          confirm: true,
          description: payment.description ?? b.offering?.title ?? "PURE Academy lesson",
          metadata: { paymentId: payment.id, lessonSeriesId: b.series.id },
        },
        { idempotencyKey: `lessoncharge:${payment.id}` },
      );
      if (pi.status === "succeeded") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: now, method: "STRIPE", stripePaymentIntentId: pi.id } });
        await prisma.alaCarteBooking.update({ where: { id: b.id }, data: { status: "ACCEPTED" } });
        await audit({ entityType: "Payment", entityId: payment.id, action: "PAID", summary: "Lesson auto-charged (saved card)" });
        // Receipt to the player.
        await dispatchMessage({
          audienceType: "SINGLE_PERSON", audienceRef: b.clientId, channels: ["EMAIL", "SMS"],
          triggerType: "LESSON_CHARGED", subject: "Lesson payment received — PURE Academy",
          body: `We charged your card on file ${formatCents(payment.amountCents)} for your ${b.offering?.title ?? "lesson"}${coachName ? ` with ${coachName}` : ""}${b.scheduledAt ? ` on ${whenLabel(b.scheduledAt)}` : ""}. See you on the court!`,
          smsBody: `PURE Academy — ${formatCents(payment.amountCents)} charged for your ${b.offering?.title ?? "lesson"}${b.scheduledAt ? ` on ${whenLabel(b.scheduledAt)}` : ""}. See you on the court!`,
        }).catch(() => {});
        charged++;
      } else {
        // requires_action / processing — can't complete off-session; fall back.
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", stripePaymentIntentId: pi.id } });
        await sendLessonPayLink({ id: b.id, clientId: b.clientId, payment, offering: b.offering, coach: b.coach, facilityName, scheduledAt: b.scheduledAt });
        await notifyAdminsPaymentFailed(payment.id).catch(() => {});
        if (b.coach?.person?.id) {
          await dispatchMessage({ audienceType: "SINGLE_PERSON", audienceRef: b.coach.person.id, channels: ["IN_APP"], triggerType: "LESSON_PAYMENT_FAILED", subject: "Lesson payment needs attention", body: `A lesson charge for ${b.offering?.title ?? "a lesson"}${b.scheduledAt ? ` on ${whenLabel(b.scheduledAt)}` : ""} couldn't be completed on the saved card. The player has been emailed a pay link.` }).catch(() => {});
        }
        declined++;
      }
    } catch (e) {
      // Card declined / authentication required / Stripe error → pay-link fallback.
      console.error("lesson off-session charge failed", e);
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } }).catch(() => {});
      await sendLessonPayLink({ id: b.id, clientId: b.clientId, payment, offering: b.offering, coach: b.coach, facilityName, scheduledAt: b.scheduledAt });
      await audit({ entityType: "Payment", entityId: payment.id, action: "PAYMENT_FAILED", summary: "Lesson auto-charge declined" });
      await notifyAdminsPaymentFailed(payment.id).catch(() => {});
      if (b.coach?.person?.id) {
        await dispatchMessage({ audienceType: "SINGLE_PERSON", audienceRef: b.coach.person.id, channels: ["IN_APP"], triggerType: "LESSON_PAYMENT_FAILED", subject: "Lesson payment needs attention", body: `A lesson charge for ${b.offering?.title ?? "a lesson"}${b.scheduledAt ? ` on ${whenLabel(b.scheduledAt)}` : ""} was declined on the saved card. The player has been emailed a pay link.` }).catch(() => {});
      }
      declined++;
    }
  }
  return { scanned: due.length, charged, declined, payLinked };
}

/**
 * "Your lesson is today" reminder to the player + the coach, ~2h out. Only
 * confirmed (paid) lessons — an unpaid one is handled by the charge/pay-link
 * path, not a see-you-there text. Idempotent via reminderSentAt.
 */
export async function remindUpcomingLessons(now: Date): Promise<{ scanned: number; reminded: number }> {
  const from = new Date(now.getTime() - 60 * 60 * 1000);
  const to = new Date(now.getTime() + (REMIND_LEAD_MIN + 5) * 60 * 1000);
  const soon = await prisma.alaCarteBooking.findMany({
    where: {
      status: { in: ["ACCEPTED", "DELIVERED"] },
      reminderSentAt: null,
      scheduledAt: { gte: from, lte: to },
    },
    include: {
      offering: { select: { title: true } },
      coach: { select: { person: { select: { id: true, firstName: true, phone: true } } } },
    },
    take: 200,
  });

  let reminded = 0;
  for (const b of soon) {
    if (!b.scheduledAt) continue;
    const minsUntil = (b.scheduledAt.getTime() - now.getTime()) / 60000;
    if (minsUntil > REMIND_LEAD_MIN || minsUntil < -REMIND_GRACE_MIN) continue;

    const facility = b.facilityId ? await prisma.facility.findUnique({ where: { id: b.facilityId }, select: { name: true } }) : null;
    const client = await prisma.person.findUnique({ where: { id: b.clientId }, select: { firstName: true } });
    const when = formatTime12(phoenixHHMM(b.scheduledAt));
    const where = facility?.name ? ` at ${facility.name}` : "";
    const what = b.offering?.title || "lesson";
    const coachName = b.coach ? b.coach.person.firstName : null;

    await dispatchMessage({
      audienceType: "SINGLE_PERSON", audienceRef: b.clientId, channels: ["SMS", "EMAIL"],
      triggerType: "LESSON_REMINDER", subject: "Your PURE Academy lesson is today",
      body: `Reminder: your ${what}${coachName ? ` with ${coachName}` : ""} is today at ${when}${where}. See you on the court!`,
      smsBody: `PURE Academy — reminder: ${client?.firstName ?? "your"} ${what} is today at ${when}${where}. See you on the court!`,
    }).catch(() => {});

    if (b.coach?.person?.id) {
      await dispatchMessage({
        audienceType: "SINGLE_PERSON", audienceRef: b.coach.person.id, channels: ["SMS", "IN_APP"],
        triggerType: "LESSON_REMINDER", subject: "You have a lesson today",
        body: `You have a ${what} with ${client?.firstName ?? "a client"} today at ${when}${where}.`,
        smsBody: `PURE Academy — you have a ${what} with ${client?.firstName ?? "a client"} today at ${when}${where}.`,
      }).catch(() => {});
    }

    await prisma.alaCarteBooking.update({ where: { id: b.id }, data: { reminderSentAt: now } });
    reminded++;
  }
  return { scanned: soon.length, reminded };
}

/**
 * Release the court held by a series whose first lesson was never paid. A series
 * with no confirmed (ACCEPTED/DELIVERED) booking, older than the grace window,
 * is treated as abandoned: cancel it, cancel its bookings, and free their holds
 * so the court-time is bookable again.
 */
export async function releaseAbandonedLessons(now: Date): Promise<{ series: number; holds: number }> {
  const cutoff = new Date(now.getTime() - ABANDON_GRACE_MS);
  const abandoned = await prisma.lessonSeries.findMany({
    where: {
      status: "ACTIVE",
      createdAt: { lt: cutoff },
      bookings: { none: { status: { in: ["ACCEPTED", "DELIVERED"] } } },
    },
    select: { id: true, bookings: { select: { id: true } } },
    take: 100,
  });

  let holds = 0;
  for (const s of abandoned) {
    for (const bk of s.bookings) {
      await releaseCourtHolds("LESSON", bk.id).catch(() => {});
      await prisma.alaCarteBooking.update({ where: { id: bk.id }, data: { status: "CANCELLED" } }).catch(() => {});
      holds++;
    }
    await prisma.lessonSeries.update({ where: { id: s.id }, data: { status: "CANCELLED" } }).catch(() => {});
    await audit({ entityType: "LessonSeries", entityId: s.id, action: "CANCELLED", summary: "Abandoned unpaid lesson booking — court released" });
  }
  return { series: abandoned.length, holds };
}
