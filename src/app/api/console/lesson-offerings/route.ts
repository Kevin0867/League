import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";

// Coach "Private/Group lesson pricing" setup: a coach manages their own lesson
// OFFERINGS (format, group size, length, price, preferred locations, recurrence),
// their weekly availability + dated time-off, and their phone-calendar link.
// Admins (manageCoaches) may edit any coach by passing `personId`. Every coach
// edit notifies the admins so a change is never silent.
export const dynamic = "force-dynamic";

const LESSON_TYPES = new Set(["PRIVATE", "SEMI_PRIVATE", "GROUP"]);

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const list = (k: string) => fd.getAll(k).map((v) => String(v).trim()).filter(Boolean);

  // Whose setup is being edited — own, or (admins only) another coach's.
  const targetPersonId = g("personId");
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const editingOther = !!targetPersonId && targetPersonId !== me?.personId;
  if (editingOther && !can(actor.role, "manageCoaches")) {
    return NextResponse.redirect(new URL("/console/coaches?err=auth", origin), 303);
  }
  const personId = editingOther ? targetPersonId : me?.personId ?? "";
  if (!personId) return NextResponse.redirect(new URL("/console/profile?err=noperson", origin), 303);
  const returnBase = editingOther ? `/console/profile/lessons?coach=${personId}` : "/console/profile/lessons";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  // The coach row (a COACH login may not have one yet — create on first save).
  const coach = await prisma.coach.upsert({ where: { personId }, create: { personId }, update: {} });

  const op = g("op");
  const cents = (k: string) => { const n = parseFloat(g(k)); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
  const int = (k: string) => { const n = parseInt(g(k), 10); return Number.isFinite(n) && n > 0 ? n : null; };

  const notifyAdmins = async (what: string) => {
    if (editingOther) return; // an admin's own edit doesn't need to alert admins
    const name = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true } });
    const who = name ? `${name.firstName} ${name.lastName}`.trim() : "A coach";
    await dispatchMessage({
      senderId: actor.userId,
      audienceType: "ALL_ADMINS",
      channels: ["IN_APP", "EMAIL"],
      triggerType: "COACH_LESSON_SETUP",
      subject: `${who} updated their lesson setup`,
      body: `${who} ${what}. Review it under Coaches → ${who} → Private/Group lesson pricing.`,
    }).catch((e) => console.error("lesson-setup admin notify failed", e));
  };

  // -- Create or update one offering ----------------------------------------
  if (op === "saveOffering") {
    const type = g("type").toUpperCase();
    if (!LESSON_TYPES.has(type)) return back("?err=type");
    const priceCents = cents("price");
    if (priceCents == null || priceCents <= 0) return back("?err=price");
    const lengthMin = int("lengthMin");
    if (!lengthMin) return back("?err=length");
    const minPeople = type === "PRIVATE" ? 1 : int("minPeople") ?? (type === "SEMI_PRIVATE" ? 2 : 2);
    const maxPeople = type === "PRIVATE" ? 1 : Math.max(minPeople, int("maxPeople") ?? minPeople);
    const title = g("title") || `${type === "PRIVATE" ? "Private" : type === "SEMI_PRIVATE" ? "Semi-private" : "Group"} lesson — ${lengthMin} min`;
    const preferred = list("facility");
    const data = {
      type, title, description: g("description") || null,
      priceCents, lengthMin, minPeople, maxPeople,
      preferredFacilityIds: preferred.length ? preferred : undefined,
      recurrenceAllowed: g("recurrenceAllowed") === "on",
      coachSet: true, coachId: coach.id,
      active: g("active") !== "off",
    };
    const id = g("offeringId");
    if (id) {
      // Only touch this coach's own offering.
      const existing = await prisma.alaCarteOffering.findFirst({ where: { id, coachId: coach.id }, select: { id: true } });
      if (!existing) return back("?err=notfound");
      await prisma.alaCarteOffering.update({ where: { id }, data });
    } else {
      await prisma.alaCarteOffering.create({ data });
    }
    await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "lesson.offering.save", summary: `${id ? "Updated" : "Added"} a ${type} lesson offering ($${(priceCents / 100).toFixed(2)})` });
    await notifyAdmins(`${id ? "updated" : "added"} a ${type.replace("_", "-").toLowerCase()} lesson offering ($${(priceCents / 100).toFixed(0)}, ${lengthMin} min)`);
    return back("?ok=offering");
  }

  if (op === "deleteOffering") {
    const id = g("offeringId");
    const existing = await prisma.alaCarteOffering.findFirst({ where: { id, coachId: coach.id }, select: { id: true, _count: { select: { bookings: true } } } });
    if (!existing) return back("?err=notfound");
    // Keep the row if it already has bookings (history/payout integrity) — just
    // deactivate it; otherwise remove it cleanly.
    if (existing._count.bookings > 0) {
      await prisma.alaCarteOffering.update({ where: { id }, data: { active: false } });
    } else {
      await prisma.alaCarteOffering.delete({ where: { id } });
    }
    await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "lesson.offering.delete", summary: `Removed a lesson offering` });
    await notifyAdmins("removed a lesson offering");
    return back("?ok=offeringdel");
  }

  // -- Weekly availability (wholesale) + phone calendar URL -----------------
  if (op === "saveAvailability") {
    const days = list("availDay");
    const starts = fd.getAll("availStart").map((v) => String(v).trim());
    const ends = fd.getAll("availEnd").map((v) => String(v).trim());
    await prisma.availabilityBlock.deleteMany({ where: { coachId: coach.id } });
    for (let i = 0; i < days.length; i++) {
      if (days[i] && starts[i] && ends[i]) {
        await prisma.availabilityBlock.create({ data: { coachId: coach.id, dayOfWeek: days[i], startTime: starts[i], endTime: ends[i] } });
      }
    }
    const url = g("externalCalendarUrl");
    await prisma.coach.update({ where: { id: coach.id }, data: { externalCalendarUrl: url || null } });
    await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "lesson.availability.save", summary: "Updated lesson availability" });
    await notifyAdmins("updated their weekly lesson availability");
    return back("?ok=availability");
  }

  // -- Dated time-off / extra availability ----------------------------------
  if (op === "addException") {
    const date = g("date");
    if (!date) return back("?err=date");
    await prisma.availabilityException.create({
      data: {
        coachId: coach.id, date: new Date(`${date}T12:00:00Z`),
        startTime: g("startTime") || null, endTime: g("endTime") || null,
        kind: g("kind") === "OPEN" ? "OPEN" : "BLOCK", note: g("note") || null,
      },
    });
    await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "lesson.exception.add", summary: `Added a ${g("kind") === "OPEN" ? "extra availability" : "time-off"} day (${date})` });
    await notifyAdmins(`marked ${g("kind") === "OPEN" ? "extra availability" : "time off"} on ${date}`);
    return back("?ok=exception");
  }

  if (op === "deleteException") {
    const id = g("exceptionId");
    await prisma.availabilityException.deleteMany({ where: { id, coachId: coach.id } });
    return back("?ok=exceptiondel");
  }

  return back("?err=op");
}
