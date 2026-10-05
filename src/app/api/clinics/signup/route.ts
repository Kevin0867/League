import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { activeBookingCount, formatClinicWhen } from "@/lib/domain/clinics";

// PUBLIC clinic signup — no login. Anyone with the link can reserve a spot:
// we reuse/create a Person by email, create a booking + an ALA_CARTE payment,
// and hand off to the PUBLIC /pay page (payment id is the capability token).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const offeringId = String(fd.get("offeringId") ?? "");
  const back = (qs: string) => NextResponse.redirect(new URL(`/clinics/${offeringId}${qs}`, origin), 303);

  const firstName = String(fd.get("firstName") ?? "").trim();
  const lastName = String(fd.get("lastName") ?? "").trim();
  const email = String(fd.get("email") ?? "").toLowerCase().trim();
  const phone = String(fd.get("phone") ?? "").trim();
  if (!firstName || !lastName || !email) return back("?err=fields");

  const offering = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId }, include: { facility: true, classSessions: { orderBy: { scheduledAt: "asc" } } } });
  const isClinic = offering && offering.type === "CLINIC" && offering.active && offering.capacity != null;
  const sessions = offering?.classSessions ?? [];
  const lastDate = sessions.length ? sessions[sessions.length - 1].scheduledAt : offering?.scheduledAt ?? null;
  const isPast = lastDate ? lastDate.getTime() < Date.now() : false;
  if (!offering || !isClinic || isPast) return back("?err=closed");

  // Capacity re-check at submit time (the page count can be stale).
  const taken = await activeBookingCount(offering.id);
  if (taken >= (offering.capacity ?? 0)) return back("?err=full");

  // Reuse a Person with this email, else create one. Backfill contact if missing.
  const existing = await prisma.person.findFirst({ where: { email } });
  const person = existing
    ? await prisma.person.update({
        where: { id: existing.id },
        data: { phone: existing.phone || phone || null },
      })
    : await prisma.person.create({ data: { firstName, lastName, email, phone: phone || null } });

  // For a multi-week class, book the spot against the first session and note the
  // full span in the description; a single clinic keeps its one date.
  const startAt = sessions.length ? sessions[0].scheduledAt : offering.scheduledAt;
  const when = formatClinicWhen(startAt);
  const description = sessions.length > 1
    ? `${offering.title}${offering.facility ? ` — ${offering.facility.name}` : ""} (${sessions.length}-week class, starts ${when})`
    : `${offering.title}${offering.facility ? ` — ${offering.facility.name}` : ""}${startAt ? `, ${when}` : ""}`;

  // Booking holds the spot; grossCents lets the split be computed on delivery.
  const booking = await prisma.alaCarteBooking.create({
    data: {
      offeringId: offering.id,
      clientId: person.id,
      coachId: offering.coachId,
      status: "REQUESTED",
      grossCents: offering.priceCents,
      scheduledAt: startAt,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      direction: "IN",
      partyId: person.id,
      amountCents: offering.priceCents,
      method: "STRIPE",
      status: "REQUESTED",
      category: "ALA_CARTE",
      description,
    },
  });

  await audit({
    actorId: null,
    entityType: "AlaCarteBooking",
    entityId: booking.id,
    action: "PUBLIC_SIGNUP",
    summary: `Public clinic signup: ${person.firstName} ${person.lastName} → ${offering.title}`,
  });

  // Straight to the public pay page — one-time charge, no login.
  return NextResponse.redirect(new URL(`/pay/${payment.id}?plan=full`, origin), 303);
}
