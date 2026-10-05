import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { createLessonBooking } from "@/lib/domain/lessonBooking";

// PUBLIC lesson booking — no login. The player picked a coach, offering, location,
// slot (and optional recurrence) and entered their contact info. We create the
// series + bookings + court holds + their Person, then hand off to the public pay
// page for the first lesson. The coach and admins are notified of the new booking.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const g = (k: string) => String(fd.get(k) ?? "").trim();

  const coachPersonId = g("coachPersonId");
  const backTo = coachPersonId ? `/lessons/${coachPersonId}` : "/lessons";
  const back = (qs: string) => NextResponse.redirect(new URL(`${backTo}${qs}`, origin), 303);

  const offeringId = g("offeringId");
  const facilityId = g("facilityId");
  const slot = g("slot"); // "YYYY-MM-DD|HH:MM"
  const [startDay, startTime] = slot.split("|");
  const firstName = g("firstName"), lastName = g("lastName"), email = g("email"), phone = g("phone");
  if (!offeringId || !facilityId || !startDay || !startTime) return back("?err=slot");
  if (!firstName || !lastName || !email) return back("?err=fields");

  // Recurrence.
  const recurring = g("recurring") === "on";
  const cadence = recurring ? (g("cadence") || "WEEKLY") : "ONCE";
  const endType = !recurring ? "ONCE" : g("endType") === "UNTIL_DATE" ? "UNTIL_DATE" : "COUNT";
  const count = endType === "COUNT" ? Math.max(1, parseInt(g("count") || "5", 10)) : null;
  const endDate = endType === "UNTIL_DATE" && g("endDate") ? new Date(`${g("endDate")}T23:59:59Z`) : null;
  const people = Math.max(1, parseInt(g("people") || "1", 10));

  // Group roster: the other players' names/emails (parallel fields), for waivers
  // and roster tracking. Keep only rows with at least a name or an email.
  const rNames = fd.getAll("rosterName").map((v) => String(v).trim());
  const rEmails = fd.getAll("rosterEmail").map((v) => String(v).trim());
  const roster = rNames
    .map((nm, i) => ({ name: nm, email: (rEmails[i] ?? "").toLowerCase() }))
    .filter((r) => r.name || r.email);

  const result = await createLessonBooking({
    offeringId, facilityId, startDay, startTime, people,
    cadence, intervalN: 1, endType, count, endDate,
    client: { firstName, lastName, email, phone },
    roster,
    promoCode: g("promoCode") || undefined,
    packageDiscountPct: g("packageDiscountPct") ? Math.max(0, Math.min(90, parseInt(g("packageDiscountPct"), 10) || 0)) : null,
  });

  if (!result.ok || !result.firstPaymentId) {
    return back(`?err=${encodeURIComponent(result.error ?? "Couldn't book that time.")}`);
  }

  // Notify the coach + admins (staff-only; never hits a family inbox).
  try {
    const offering = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId }, select: { coach: { select: { personId: true } } } });
    const whenLabel = `${startDay} ${startTime}`;
    const summary = `${firstName} ${lastName} booked a lesson (${result.booked} session${result.booked === 1 ? "" : "s"}) starting ${whenLabel}.`;
    if (offering?.coach?.personId) {
      await dispatchMessage({ audienceType: "SINGLE_PERSON", audienceRef: offering.coach.personId, channels: ["IN_APP", "EMAIL"], triggerType: "COACH_LESSON_ASSIGNED", subject: "New lesson booked", body: summary }).catch(() => {});
    }
    await dispatchMessage({ audienceType: "ALL_ADMINS", channels: ["IN_APP"], triggerType: "COACH_LESSON_ASSIGNED", subject: "New lesson booked", body: summary }).catch(() => {});
  } catch (e) { console.error("lesson booking notify failed", e); }

  await audit({ actorId: null, entityType: "LessonSeries", entityId: result.seriesId ?? "", action: "PUBLIC_LESSON_BOOK", summary: `Public lesson booking: ${firstName} ${lastName} — ${result.booked} session(s)` });

  // First lesson → public pay page (payment id is the capability token).
  return NextResponse.redirect(new URL(`/pay/${result.firstPaymentId}?plan=full&lessonbooked=${result.booked}${result.skipped ? `&skipped=${result.skipped}` : ""}`, origin), 303);
}
