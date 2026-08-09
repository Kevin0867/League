"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { computeSplit } from "@/lib/domain/splits";
import { durationHours, isWeekend } from "@/lib/domain/finance";

async function requireAlaCarteManager() {
  const session = await getSession();
  if (!session || !can(session.role, "manageAlaCarte")) {
    throw new Error("Not authorized to manage à la carte.");
  }
  return session;
}

/**
 * Create a catalog offering (§11). Priced by PURE per venue — coaches do NOT set
 * their own prices. Venue must permit à la carte use (Facility.alaCarteAllowed),
 * negotiated per agreement, not assumed.
 */
export async function createOffering(formData: FormData) {
  const session = await requireAlaCarteManager();
  const facilityId = String(formData.get("facilityId") ?? "");
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new Error("Facility not found.");
  if (!facility.alaCarteAllowed) {
    throw new Error(`${facility.name} does not permit à la carte use — negotiate it into the agreement first.`);
  }

  const priceDollars = Number(formData.get("price") ?? 0);
  await prisma.alaCarteOffering.create({
    data: {
      type: String(formData.get("type") ?? "PRIVATE"),
      title: String(formData.get("title") ?? "").trim() || "Lesson",
      facilityId,
      coachId: String(formData.get("coachId") ?? "") || null,
      priceCents: Math.round(priceDollars * 100),
      active: true,
    },
  });
  await audit({ actorId: session.userId, entityType: "AlaCarteOffering", entityId: facilityId, action: "CREATE", summary: "Created à la carte offering" });
  revalidatePath("/console/alacarte");
}

/** Coach accepts or declines a booking request (§11). */
export async function respondToBooking(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const bookingId = String(formData.get("bookingId") ?? "");
  const decision = String(formData.get("decision") ?? "");

  const booking = await prisma.alaCarteBooking.findUnique({ where: { id: bookingId }, include: { coach: true } });
  if (!booking) throw new Error("Booking not found.");

  // A coach may only respond to their own bookings; admins may respond to any.
  const isOwnCoach = booking.coach?.personId === session.personId;
  if (!isOwnCoach && !can(session.role, "manageAlaCarte")) {
    throw new Error("Not authorized to respond to this booking.");
  }

  await prisma.alaCarteBooking.update({
    where: { id: bookingId },
    data: { status: decision === "ACCEPT" ? "ACCEPTED" : "DECLINED" },
  });
  await audit({ actorId: session.userId, entityType: "AlaCarteBooking", entityId: bookingId, action: decision === "ACCEPT" ? "ACCEPT" : "DECLINE" });
  revalidatePath("/console/alacarte");
}

/**
 * Mark a booking delivered and compute the revenue split (§0, §11). Court cost
 * comes off the top; the split is applied to net. The rate set is resolved from
 * who taught (Director vs assigned Coach) and STAMPED onto the transaction so a
 * historical payout survives a rate change. Earnings flow into the coach payout.
 */
export async function deliverBooking(formData: FormData) {
  const session = await requireAlaCarteManager();
  const bookingId = String(formData.get("bookingId") ?? "");
  const directorTaught = formData.get("directorTaught") === "on";

  const booking = await prisma.alaCarteBooking.findUnique({
    where: { id: bookingId },
    include: { offering: { include: { facility: true } } },
  });
  if (!booking) throw new Error("Booking not found.");

  const gross = booking.offering.priceCents;

  // Court cost: explicit input, or derived from the facility's per-hour rate for
  // a one-hour single-court slot.
  const courtCostInput = formData.get("courtCost");
  let courtCostCents: number;
  if (courtCostInput !== null && String(courtCostInput) !== "") {
    courtCostCents = Math.round(Number(courtCostInput) * 100);
  } else {
    const f = booking.offering.facility;
    const now = new Date();
    const rate = isWeekend(now) ? f.weekendRateCents : f.weekdayRateCents;
    courtCostCents = f.feeBasis === "PER_HOUR" ? Math.round(rate * durationHours("00:00", "01:00")) : rate;
  }

  const split = computeSplit(gross, courtCostCents, directorTaught);

  await prisma.alaCarteBooking.update({
    where: { id: bookingId },
    data: {
      status: "DELIVERED",
      directorTaught,
      scheduledAt: new Date(),
      grossCents: split.grossCents,
      courtCostCents: split.courtCostCents,
      netCents: split.netCents,
      coachCents: split.coachCents,
      directorCents: split.directorCents,
      pureCents: split.pureCents,
      appliedCoachPct: split.rates.coachPct,
      appliedDirectorPct: split.rates.directorPct,
      appliedPurePct: split.rates.purePct,
    },
  });

  await audit({
    actorId: session.userId, entityType: "AlaCarteBooking", entityId: bookingId, action: "DELIVER",
    summary: `Delivered; split coach ${split.coachCents} / dir ${split.directorCents} / PURE ${split.pureCents} of net ${split.netCents}`,
  });
  revalidatePath("/console/alacarte");
  revalidatePath("/console/payments");
}
