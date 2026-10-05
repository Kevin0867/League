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
  /** Dated sessions for a multi-week class (ascending). Empty for a single clinic. */
  sessions: Date[];
  targetLabel: string | null;
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
    include: { facility: true, coach: { include: { person: true } }, classSessions: { orderBy: { scheduledAt: "asc" } } },
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
    // Hide clinics whose LAST session has already passed (a multi-week class
    // stays listed until its final week; a single clinic until its date).
    .filter((o) => {
      const last = o.classSessions.length ? o.classSessions[o.classSessions.length - 1].scheduledAt : o.scheduledAt;
      return !last || last.getTime() >= now;
    })
    .map((o) => {
      const capacity = o.capacity ?? 0;
      const taken = takenBy.get(o.id) ?? 0;
      const spotsLeft = Math.max(0, capacity - taken);
      const sessions = o.classSessions.map((s) => s.scheduledAt);
      const target = clinicTargetLabel(o);
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        priceCents: o.priceCents,
        capacity,
        scheduledAt: sessions.length ? sessions[0] : o.scheduledAt,
        facilityName: o.facility?.name ?? "",
        coachName: o.coach ? `${o.coach.person.firstName} ${o.coach.person.lastName}` : null,
        taken,
        spotsLeft,
        isFull: spotsLeft === 0,
        sessions,
        targetLabel: target,
      };
    });
}

// Target label from an offering's targeting fields (null = open to all).
export function clinicTargetLabel(o: { targetMinRating: number | null; targetMaxRating: number | null; targetGender: string | null; targetAgeGroup: string | null }): string | null {
  const parts: string[] = [];
  if (o.targetMinRating != null && o.targetMaxRating != null) parts.push(`${o.targetMinRating.toFixed(1)}–${o.targetMaxRating.toFixed(1)} DUPR`);
  else if (o.targetMinRating != null) parts.push(`${o.targetMinRating.toFixed(1)}+ DUPR`);
  else if (o.targetMaxRating != null) parts.push(`up to ${o.targetMaxRating.toFixed(1)} DUPR`);
  if (o.targetGender === "MALE") parts.push("men");
  else if (o.targetGender === "FEMALE") parts.push("women");
  if (o.targetAgeGroup === "YOUTH") parts.push("youth");
  else if (o.targetAgeGroup === "ADULT") parts.push("adults");
  return parts.length ? parts.join(" · ") : null;
}

export { ACTIVE_BOOKING_STATUSES };

export function formatClinicWhen(d: Date | null): string {
  if (!d) return "Date to be announced";
  return d.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
