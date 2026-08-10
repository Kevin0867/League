import { prisma } from "@/lib/db";

// A clinic is publicly listed when it's active, of type CLINIC, and has a
// capacity set (per-person price). Private/semi-private lessons never appear
// publicly — those are set up internally with a payment request.
export const PUBLIC_CLINIC_WHERE = { active: true, type: "CLINIC", capacity: { not: null } } as const;

export type PublicClinic = {
  id: string;
  title: string;
  description: string | null;
  priceCents: number;
  capacity: number;
  scheduledAt: Date | null;
  facilityName: string;
  coachName: string | null;
  taken: number;
  spotsLeft: number;
  isFull: boolean;
};

// Bookings that count against capacity — anything not cancelled/declined.
const ACTIVE_BOOKING_STATUSES = ["REQUESTED", "ACCEPTED", "DELIVERED", "CONFIRMED"];

export async function activeBookingCount(offeringId: string): Promise<number> {
  return prisma.alaCarteBooking.count({
    where: { offeringId, status: { notIn: ["CANCELLED", "DECLINED"] } },
  });
}

export async function listPublicClinics(): Promise<PublicClinic[]> {
  const offerings = await prisma.alaCarteOffering.findMany({
    where: PUBLIC_CLINIC_WHERE,
    include: { facility: true, coach: { include: { person: true } } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
  });
  const counts = await prisma.alaCarteBooking.groupBy({
    by: ["offeringId"],
    where: { status: { notIn: ["CANCELLED", "DECLINED"] }, offeringId: { in: offerings.map((o) => o.id) } },
    _count: { _all: true },
  });
  const takenBy = new Map(counts.map((c) => [c.offeringId, c._count._all]));

  const now = Date.now();
  return offerings
    // Hide clinics whose scheduled time has already passed.
    .filter((o) => !o.scheduledAt || o.scheduledAt.getTime() >= now)
    .map((o) => {
      const capacity = o.capacity ?? 0;
      const taken = takenBy.get(o.id) ?? 0;
      const spotsLeft = Math.max(0, capacity - taken);
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        priceCents: o.priceCents,
        capacity,
        scheduledAt: o.scheduledAt,
        facilityName: o.facility.name,
        coachName: o.coach ? `${o.coach.person.firstName} ${o.coach.person.lastName}` : null,
        taken,
        spotsLeft,
        isFull: spotsLeft === 0,
      };
    });
}

export { ACTIVE_BOOKING_STATUSES };

export function formatClinicWhen(d: Date | null): string {
  if (!d) return "Date to be announced";
  return d.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
