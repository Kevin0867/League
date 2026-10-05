import "server-only";
import { prisma } from "@/lib/db";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";
import { phoenixDateInput, formatTime12, formatDate } from "@/lib/time";
import { isCourtTimeFree, createCourtHold, addMinutesHHMM, toMin, phoenixHHMM } from "@/lib/domain/courtHold";

// Turn a player's slot pick (+ optional recurrence) into real bookings: a
// LessonSeries header, one AlaCarteBooking per occurrence (reusing the à-la-carte
// money/payout/calendar plumbing), a CourtHold for each, a Payment per lesson
// (per-lesson billing — the first is charged now, the rest in Phase 4), and the
// client's Person record. The first occurrence must still be free; later
// recurrences that collide are skipped and reported.

export type Occurrence = { day: string; start: string };

export function generateOccurrences(opts: {
  startDay: string; startTime: string; cadence: string; intervalN: number; endType: string; count?: number | null; endDate?: Date | null;
}): Occurrence[] {
  const out: Occurrence[] = [{ day: opts.startDay, start: opts.startTime }];
  if (opts.cadence === "ONCE" || opts.endType === "ONCE") return out;
  const cursor = new Date(`${opts.startDay}T12:00:00Z`);
  const step = () => { if (opts.cadence === "MONTHLY") cursor.setUTCMonth(cursor.getUTCMonth() + opts.intervalN); else cursor.setUTCDate(cursor.getUTCDate() + 7 * opts.intervalN); };
  const maxN = opts.endType === "COUNT" ? Math.min(Math.max(1, opts.count ?? 1), 52) : 52;
  let guard = 0;
  while (out.length < maxN && guard++ < 80) {
    step();
    const day = phoenixDateInput(cursor);
    if (opts.endType === "UNTIL_DATE" && opts.endDate && new Date(`${day}T12:00:00Z`) > opts.endDate) break;
    out.push({ day, start: opts.startTime });
  }
  return out;
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** Is the coach already committed (another lesson or a session) at this time?
 *  `ignoreBookingId` skips one lesson (used when rescheduling it). */
export async function coachBusyAt(coachId: string, day: string, start: string, end: string, ignoreBookingId?: string | null): Promise<boolean> {
  const win = { start: new Date(`${day}T00:00:00Z`), end: new Date(`${day}T00:00:00Z`) };
  win.start.setUTCDate(win.start.getUTCDate() - 1);
  win.end.setUTCDate(win.end.getUTCDate() + 2);
  const s0 = toMin(start), s1 = toMin(end);
  const [lessons, sessions, busyBlocks] = await Promise.all([
    prisma.alaCarteBooking.findMany({ where: { coachId, status: { notIn: ["CANCELLED", "DECLINED"] }, scheduledAt: { gte: win.start, lt: win.end }, ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}) }, select: { scheduledAt: true, lessonLengthMin: true, offering: { select: { lengthMin: true } } } }),
    prisma.session.findMany({ where: { coaches: { some: { coachId } }, status: { notIn: ["CANCELLED", "RESCHEDULED"] }, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true } }),
    // Imported phone-calendar busy times (Phase 6).
    prisma.coachBusyBlock.findMany({ where: { coachId, endAt: { gte: win.start }, startAt: { lt: win.end } }, select: { startAt: true, endAt: true } }),
  ]);
  for (const l of lessons) {
    if (!l.scheduledAt || phoenixDateInput(l.scheduledAt) !== day) continue;
    const ls = toMin(phoenixHHMM(l.scheduledAt));
    const len = l.lessonLengthMin ?? l.offering?.lengthMin ?? 60;
    if (overlaps(s0, s1, ls, ls + len)) return true;
  }
  for (const se of sessions) {
    if (phoenixDateInput(se.date) !== day) continue;
    if (overlaps(s0, s1, toMin(se.startTime), toMin(se.endTime))) return true;
  }
  // An imported busy block, clipped to this Phoenix day, that overlaps the slot.
  for (const bb of busyBlocks) {
    const startDay = phoenixDateInput(bb.startAt);
    const endDay = phoenixDateInput(bb.endAt);
    if (day < startDay || day > endDay) continue;
    const bs = day === startDay ? toMin(phoenixHHMM(bb.startAt)) : 0;
    const be = day === endDay ? toMin(phoenixHHMM(bb.endAt)) : 1440;
    if (be > bs && overlaps(s0, s1, bs, be)) return true;
  }
  return false;
}

export type BookResult = { ok: boolean; firstPaymentId?: string; booked: number; skipped: number; seriesId?: string; coachName?: string; error?: string };

export async function createLessonBooking(opts: {
  offeringId: string;
  facilityId: string;
  startDay: string;
  startTime: string;
  people: number;
  cadence: string;          // ONCE | WEEKLY | MONTHLY
  intervalN: number;
  endType: string;          // ONCE | COUNT | UNTIL_DATE
  count?: number | null;
  endDate?: Date | null;
  client: { firstName: string; lastName: string; email: string; phone?: string };
  roster?: { name: string; email: string }[];
}): Promise<BookResult> {
  const offering = await prisma.alaCarteOffering.findUnique({
    where: { id: opts.offeringId },
    select: { id: true, title: true, type: true, coachId: true, priceCents: true, adminLockedPriceCents: true, recurringDiscountPct: true, lengthMin: true, active: true, coach: { select: { person: { select: { firstName: true, lastName: true } } } } },
  });
  if (!offering || !offering.active) return { ok: false, booked: 0, skipped: 0, error: "This lesson isn't available." };
  const lengthMin = offering.lengthMin ?? 60;
  // priceCents is PER PERSON. The per-lesson charge = per-person × #people, and a
  // recurring series takes the optional per-lesson discount off each lesson.
  const perPersonCents = offering.adminLockedPriceCents ?? offering.priceCents;
  const people = Math.max(1, opts.people);
  const isRecurring = opts.cadence !== "ONCE" && opts.endType !== "ONCE";
  const discountPct = isRecurring ? Math.min(90, Math.max(0, offering.recurringDiscountPct ?? 0)) : 0;
  const price = Math.round(perPersonCents * people * (1 - discountPct / 100));
  const coachId = offering.coachId ?? null;
  const coachName = offering.coach ? `${offering.coach.person.firstName} ${offering.coach.person.lastName}`.trim() : "your coach";
  const facility = await prisma.facility.findUnique({ where: { id: opts.facilityId }, select: { name: true } });

  // Client Person (reuse by email, else create).
  const email = opts.client.email.toLowerCase().trim();
  const existing = await prisma.person.findFirst({ where: { email } });
  const person = existing
    ? await prisma.person.update({ where: { id: existing.id }, data: { phone: existing.phone || opts.client.phone || null } })
    : await prisma.person.create({ data: { firstName: opts.client.firstName, lastName: opts.client.lastName, email, phone: opts.client.phone || null } });

  const occurrences = generateOccurrences({ startDay: opts.startDay, startTime: opts.startTime, cadence: opts.cadence, intervalN: opts.intervalN, endType: opts.endType, count: opts.count, endDate: opts.endDate });

  const series = await prisma.lessonSeries.create({
    data: {
      offeringId: offering.id, coachId, clientId: person.id, facilityId: opts.facilityId,
      cadence: opts.cadence, intervalN: opts.intervalN, endType: opts.endType, endDate: opts.endDate ?? null, count: opts.count ?? null,
      people: Math.max(1, opts.people), priceCents: price, status: "ACTIVE",
      roster: opts.roster && opts.roster.length ? opts.roster : undefined,
    },
  });

  let firstPaymentId: string | undefined;
  let booked = 0, skipped = 0;
  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    const end = addMinutesHHMM(occ.start, lengthMin);
    const courtFree = await isCourtTimeFree(opts.facilityId, occ.day, occ.start, end);
    const coachBusy = coachId ? await coachBusyAt(coachId, occ.day, occ.start, end) : false;
    if (!courtFree.ok || coachBusy) {
      if (i === 0) {
        // The chosen first slot was taken between preview and submit — unwind.
        await prisma.lessonSeries.delete({ where: { id: series.id } }).catch(() => {});
        return { ok: false, booked: 0, skipped: 0, error: `That time was just taken (${courtFree.reason ?? "coach busy"}). Please pick another.` };
      }
      skipped++;
      continue;
    }
    const scheduledAt = phoenixWallTimeToUtc(new Date(`${occ.day}T12:00:00Z`), occ.start);
    const booking = await prisma.alaCarteBooking.create({
      data: {
        offeringId: offering.id, clientId: person.id, coachId, status: "REQUESTED",
        grossCents: price, scheduledAt, facilityId: opts.facilityId, lessonLengthMin: lengthMin, seriesId: series.id,
      },
    });
    const desc = `${offering.title} with ${coachName}${facility ? ` at ${facility.name}` : ""} — ${formatDate(new Date(`${occ.day}T12:00:00Z`))} ${formatTime12(occ.start)}`;
    const payment = await prisma.payment.create({
      data: { direction: "IN", partyId: person.id, amountCents: price, method: "STRIPE", status: "REQUESTED", category: "ALA_CARTE", description: desc },
    });
    await prisma.alaCarteBooking.update({ where: { id: booking.id }, data: { paymentId: payment.id } });
    await createCourtHold({ facilityId: opts.facilityId, day: occ.day, startTime: occ.start, endTime: end, refType: "LESSON", refId: booking.id, note: `Lesson — ${person.firstName} ${person.lastName}` });
    if (i === 0) firstPaymentId = payment.id;
    booked++;
  }

  return { ok: true, firstPaymentId, booked, skipped, seriesId: series.id, coachName };
}
