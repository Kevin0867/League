import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { phoenixDateInput } from "@/lib/time";

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
  if (!personId) {
    // No coach resolved. An admin whose own login isn't a coach must pick which
    // coach's setup they're editing — send them to the picker, not the generic
    // "your login isn't linked to a person" profile error.
    if (can(actor.role, "manageCoaches")) {
      return NextResponse.redirect(new URL("/console/profile/lessons?err=pickcoach", origin), 303);
    }
    return NextResponse.redirect(new URL("/console/profile?err=noperson", origin), 303);
  }
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
    // Lesson length: 15-minute blocks, 15 min–4 hours. Reject anything else
    // rather than silently storing a 7- or 600-minute lesson.
    const lengthMin = int("lengthMin");
    if (!lengthMin || lengthMin < 15 || lengthMin > 240 || lengthMin % 15 !== 0) return back("?err=length");

    // Group size, validated per format — no silent coercion of contradictory input.
    let minPeople: number, maxPeople: number;
    if (type === "PRIVATE") {
      minPeople = 1; maxPeople = 1; // a private lesson is definitionally 1 player
    } else {
      const mn = int("minPeople");
      const mx = int("maxPeople");
      if (!mn || !mx) return back("?err=people");
      if (mn < 2) return back("?err=peoplemin");       // semi/group need ≥ 2
      if (mx < mn) return back("?err=peopleorder");     // max can't be below min
      if (mx > 20) return back("?err=peoplemax");
      minPeople = mn; maxPeople = mx;
    }

    const title = g("title") || `${type === "PRIVATE" ? "Private" : type === "SEMI_PRIVATE" ? "Semi-private" : "Group"} lesson — ${lengthMin} min`;
    const preferred = list("facility");

    // Recurring discount: only meaningful when recurrence is allowed; a whole
    // number 0–90. Reject out-of-range (don't quietly clamp 95→90 or −10→0), and
    // force it off entirely when the offering is single-only.
    const recurrenceAllowed = g("recurrenceAllowed") === "on";
    let recurringDiscountPct: number | null = null;
    if (recurrenceAllowed) {
      const discStr = g("recurringDiscountPct").trim();
      if (discStr) {
        const d = parseInt(discStr, 10);
        if (!Number.isFinite(d) || String(d) !== discStr || d < 0 || d > 90) return back("?err=discount");
        recurringDiscountPct = d > 0 ? d : null;
      }
    }

    // Multi-person price tiers (optional) — per-person $ by group size.
    const tPeople = fd.getAll("tierPeople").map((v) => parseInt(String(v), 10));
    const tPrice = fd.getAll("tierPrice").map((v) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? Math.round(n * 100) : NaN; });
    const priceTiersArr: { people: number; perPersonCents: number }[] = [];
    for (let i = 0; i < tPeople.length; i++) {
      if (!Number.isFinite(tPeople[i]) || tPeople[i] <= 0) continue;
      if (!Number.isFinite(tPrice[i]) || tPrice[i] < 0) continue;
      priceTiersArr.push({ people: tPeople[i], perPersonCents: tPrice[i] });
    }
    priceTiersArr.sort((a, b) => a.people - b.people);
    // First-lesson intro price (optional flat total).
    const introPriceCents = cents("introPrice");

    const data = {
      type, title, description: g("description") || null,
      priceCents, lengthMin, minPeople, maxPeople,
      preferredFacilityIds: preferred.length ? preferred : Prisma.DbNull,
      recurrenceAllowed,
      recurringDiscountPct,
      priceTiers: priceTiersArr.length ? priceTiersArr : Prisma.DbNull,
      introPriceCents: introPriceCents && introPriceCents > 0 ? introPriceCents : null,
      coachSet: true, coachId: coach.id,
      // An unchecked checkbox sends NO field, so "!== off" always read true and
      // Bookable could never be turned off. Checked sends "on".
      active: g("active") === "on",
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
    const days = fd.getAll("availDay").map((v) => String(v).trim());
    const starts = fd.getAll("availStart").map((v) => String(v).trim());
    const ends = fd.getAll("availEnd").map((v) => String(v).trim());
    const toMin = (hhmm: string) => { const [h, m] = (hhmm || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

    // Collect only fully-filled rows, then validate each and check for overlaps.
    const windows: { day: string; start: string; end: string }[] = [];
    for (let i = 0; i < days.length; i++) {
      if (days[i] && starts[i] && ends[i]) windows.push({ day: days[i], start: starts[i], end: ends[i] });
    }
    // Don't silently wipe everything on an accidental all-blank save.
    if (windows.length === 0) return back("?err=availnone");
    for (const w of windows) {
      if (toMin(w.end) <= toMin(w.start)) return back("?err=availorder"); // end before/equal start (incl. 9–9)
    }
    // Reject overlapping windows on the same day.
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        if (windows[i].day === windows[j].day &&
            toMin(windows[i].start) < toMin(windows[j].end) && toMin(windows[j].start) < toMin(windows[i].end)) {
          return back("?err=availoverlap");
        }
      }
    }

    // Validate the optional calendar URL before saving anything.
    const url = g("externalCalendarUrl");
    if (url && !/^(https?|webcal):\/\/.+/i.test(url)) return back("?err=calurl");

    await prisma.availabilityBlock.deleteMany({ where: { coachId: coach.id } });
    for (const w of windows) {
      await prisma.availabilityBlock.create({ data: { coachId: coach.id, dayOfWeek: w.day, startTime: w.start, endTime: w.end } });
    }
    await prisma.coach.update({ where: { id: coach.id }, data: { externalCalendarUrl: url || null } });
    await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "lesson.availability.save", summary: "Updated lesson availability" });
    await notifyAdmins("updated their weekly lesson availability");
    return back("?ok=availability");
  }

  // -- Dated time-off / extra availability ----------------------------------
  if (op === "addException") {
    const date = g("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return back("?err=date");
    // No past dates.
    const todayPhx = phoenixDateInput(new Date());
    if (date < todayPhx) return back("?err=exppast");

    const kind = g("kind") === "OPEN" ? "OPEN" : "BLOCK";
    const startTime = g("startTime") || null;
    const endTime = g("endTime") || null;
    const toMin = (hhmm: string) => { const [h, m] = (hhmm || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    // An extra-availability (OPEN) slot must have a real time range, else it's
    // meaningless ("all day" extra makes no sense); a BLOCK with no times = all day.
    if (kind === "OPEN" && (!startTime || !endTime)) return back("?err=exptimes");
    if (startTime && endTime && toMin(endTime) <= toMin(startTime)) return back("?err=exporder");

    // No duplicate entry for the same day + kind.
    const dup = await prisma.availabilityException.findFirst({
      where: { coachId: coach.id, kind, date: new Date(`${date}T12:00:00Z`) },
      select: { id: true },
    });
    if (dup) return back("?err=expdup");

    await prisma.availabilityException.create({
      data: {
        coachId: coach.id, date: new Date(`${date}T12:00:00Z`),
        startTime, endTime, kind, note: g("note") || null,
      },
    });
    await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "lesson.exception.add", summary: `Added a ${kind === "OPEN" ? "extra availability" : "time-off"} day (${date})` });
    await notifyAdmins(`marked ${kind === "OPEN" ? "extra availability" : "time off"} on ${date}`);
    return back("?ok=exception");
  }

  if (op === "deleteException") {
    const id = g("exceptionId");
    await prisma.availabilityException.deleteMany({ where: { id, coachId: coach.id } });
    return back("?ok=exceptiondel");
  }

  return back("?err=op");
}
