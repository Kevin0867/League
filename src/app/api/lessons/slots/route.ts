import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { openLessonSlots } from "@/lib/domain/lessonSlots";
import { phoenixDateInput } from "@/lib/time";

// PUBLIC: open booking slots for a coach + offering + location, as JSON — so the
// booking wizard can load times when the player picks an offering/location
// without a full-page reload. Returns [{ day, times: ["HH:MM", …] }].
export const dynamic = "force-dynamic";

function asIds(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const coachPersonId = (url.searchParams.get("coach") ?? "").trim();
  const offeringId = (url.searchParams.get("offering") ?? "").trim();
  const facilityId = (url.searchParams.get("loc") ?? "").trim();
  if (!coachPersonId || !offeringId || !facilityId) return NextResponse.json({ slots: [] });

  const coach = await prisma.coach.findFirst({ where: { personId: coachPersonId }, select: { id: true } });
  if (!coach) return NextResponse.json({ slots: [] });
  const offering = await prisma.alaCarteOffering.findFirst({
    where: { id: offeringId, coachId: coach.id, coachSet: true, active: true },
    select: { lengthMin: true, preferredFacilityIds: true },
  });
  if (!offering?.lengthMin) return NextResponse.json({ slots: [] });

  // Only allow a location the offering actually permits.
  const pref = asIds(offering.preferredFacilityIds);
  if (pref.length && !pref.includes(facilityId)) return NextResponse.json({ slots: [] });
  const fac = await prisma.facility.findFirst({ where: { id: facilityId, archived: false, alaCarteAllowed: true }, select: { id: true } });
  if (!fac) return NextResponse.json({ slots: [] });

  const from = phoenixDateInput(new Date());
  const toD = new Date(); toD.setUTCDate(toD.getUTCDate() + 42);
  const slots = await openLessonSlots({ coachId: coach.id, facilityId, lengthMin: offering.lengthMin, fromDay: from, toDay: phoenixDateInput(toD), maxSlots: 240, perDayMax: 8 });

  const byDay = new Map<string, string[]>();
  for (const s of slots) { const a = byDay.get(s.day) ?? []; a.push(s.startTime); byDay.set(s.day, a); }
  return NextResponse.json({ slots: [...byDay.entries()].map(([day, times]) => ({ day, times })) });
}
