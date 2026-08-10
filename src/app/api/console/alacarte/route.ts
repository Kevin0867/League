import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { computeSplit } from "@/lib/domain/splits";
import { durationHours, isWeekend } from "@/lib/domain/finance";
import { dispatchMessage } from "@/lib/messaging";
import { lessonPaymentEmail } from "@/lib/payments/lessonPaymentEmail";
import { formatClinicWhen } from "@/lib/domain/clinics";

// À la carte management as native-form-POST route handlers with ticket auth.
// Route handlers 303-redirect to a fresh GET (which carries the session cookie),
// so unlike a server action they don't re-render inline under the cookieless
// POST and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/alacarte${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  switch (op) {
    // Create a catalog offering (§11). Priced by PURE per venue — coaches do NOT
    // set their own prices. Venue must permit à la carte use
    // (Facility.alaCarteAllowed), negotiated per agreement, not assumed.
    case "createOffering": {
      // Original requireAlaCarteManager(): manageAlaCarte (COO/DIRECTOR).
      if (!actor || !can(actor.role, "manageAlaCarte")) return back("?err=auth");

      const facilityId = String(formData.get("facilityId") ?? "");
      const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
      if (!facility) return back("?err=facility");
      if (!facility.alaCarteAllowed) return back("?err=notallowed");

      const priceDollars = Number(formData.get("price") ?? 0);
      const capacityRaw = String(formData.get("capacity") ?? "").trim();
      const capacity = capacityRaw ? Math.max(1, Math.round(Number(capacityRaw))) : null;
      const scheduledRaw = String(formData.get("scheduledAt") ?? "").trim();
      const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;
      await prisma.alaCarteOffering.create({
        data: {
          type: String(formData.get("type") ?? "PRIVATE"),
          title: String(formData.get("title") ?? "").trim() || "Lesson",
          description: String(formData.get("description") ?? "").trim() || null,
          facilityId,
          coachId: String(formData.get("coachId") ?? "") || null,
          priceCents: Math.round(priceDollars * 100),
          capacity,
          scheduledAt: scheduledAt && !isNaN(scheduledAt.getTime()) ? scheduledAt : null,
          active: true,
        },
      });
      await audit({ actorId: actor.userId, entityType: "AlaCarteOffering", entityId: facilityId, action: "CREATE", summary: "Created à la carte offering" });
      return back("?ok=createOffering");
    }

    // Show/hide an offering (deactivating removes a clinic from the public page).
    case "toggleOffering": {
      if (!actor || !can(actor.role, "manageAlaCarte")) return back("?err=auth");
      const offeringId = String(formData.get("offeringId") ?? "");
      const active = String(formData.get("active") ?? "") === "1";
      const offering = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId } });
      if (!offering) return back("?err=notfound");
      await prisma.alaCarteOffering.update({ where: { id: offeringId }, data: { active } });
      await audit({ actorId: actor.userId, entityType: "AlaCarteOffering", entityId: offeringId, action: active ? "ACTIVATE" : "DEACTIVATE" });
      return back("?ok=createOffering");
    }

    // Admin sets up a private/semi/group lesson for named participants and sends
    // each a payment-request email. The offering is created inactive so it never
    // appears on the public Clinics page — these players are already invited.
    case "setupLesson": {
      if (!actor || !can(actor.role, "manageAlaCarte")) return back("?err=auth");

      const facilityId = String(formData.get("facilityId") ?? "");
      const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
      if (!facility) return back("?err=facility");
      if (!facility.alaCarteAllowed) return back("?err=notallowed");

      const title = String(formData.get("title") ?? "").trim() || "Lesson";
      const type = String(formData.get("type") ?? "PRIVATE");
      const coachId = String(formData.get("coachId") ?? "") || null;
      const priceCents = Math.round(Number(formData.get("price") ?? 0) * 100);
      const scheduledRaw = String(formData.get("scheduledAt") ?? "").trim();
      const scheduled = scheduledRaw ? new Date(scheduledRaw) : null;
      const scheduledAt = scheduled && !isNaN(scheduled.getTime()) ? scheduled : null;

      const firsts = formData.getAll("pFirst").map((v) => String(v).trim());
      const lasts = formData.getAll("pLast").map((v) => String(v).trim());
      const emails = formData.getAll("pEmail").map((v) => String(v).toLowerCase().trim());
      const phones = formData.getAll("pPhone").map((v) => String(v).trim());
      const participants = firsts
        .map((f, i) => ({ firstName: f, lastName: lasts[i] ?? "", email: emails[i] ?? "", phone: phones[i] ?? "" }))
        .filter((p) => p.firstName && p.lastName && p.email);
      if (participants.length === 0) return back("?err=noplayers");

      const offering = await prisma.alaCarteOffering.create({
        data: { type, title, facilityId, coachId, priceCents, scheduledAt, active: false },
      });

      const coach = coachId ? await prisma.coach.findUnique({ where: { id: coachId }, include: { person: true } }) : null;
      const coachName = coach ? `${coach.person.firstName} ${coach.person.lastName}` : null;
      const when = formatClinicWhen(scheduledAt);

      let sent = 0;
      for (const p of participants) {
        const existing = await prisma.person.findFirst({ where: { email: p.email } });
        const person = existing
          ? await prisma.person.update({ where: { id: existing.id }, data: { phone: existing.phone || p.phone || null } })
          : await prisma.person.create({ data: { firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone || null } });

        await prisma.alaCarteBooking.create({
          data: { offeringId: offering.id, clientId: person.id, coachId, status: "REQUESTED", grossCents: priceCents, scheduledAt },
        });

        const description = `${title} — ${facility.name}${scheduledAt ? `, ${when}` : ""}`;
        const payment = await prisma.payment.create({
          data: { direction: "IN", partyId: person.id, amountCents: priceCents, method: "STRIPE", status: "REQUESTED", category: "ALA_CARTE", description },
        });

        const email = lessonPaymentEmail({
          name: person.firstName, amountCents: priceCents, paymentId: payment.id,
          lessonTitle: title, coachName, facilityName: facility.name, when: scheduledAt ? when : null,
        });
        await dispatchMessage({
          senderId: actor.userId, audienceType: "SINGLE_PERSON", audienceRef: person.id,
          channels: ["IN_APP", "EMAIL"], triggerType: "PAYMENT_REQUEST",
          subject: email.subject, body: email.text, html: email.html,
        });
        sent++;
      }

      await audit({ actorId: actor.userId, entityType: "AlaCarteOffering", entityId: offering.id, action: "SETUP_LESSON", summary: `Set up ${title} for ${sent} participant(s)` });
      return back(`?ok=lessonSent&n=${sent}`);
    }

    // Coach accepts or declines a booking request (§11).
    case "respondToBooking": {
      // Original: any signed-in user, then ownership OR manageAlaCarte.
      if (!actor) return back("?err=auth");
      const bookingId = String(formData.get("bookingId") ?? "");
      const decision = String(formData.get("decision") ?? "");

      const booking = await prisma.alaCarteBooking.findUnique({ where: { id: bookingId }, include: { coach: true } });
      if (!booking) return back("?err=notfound");

      // A coach may only respond to their own bookings; admins may respond to any.
      // The ticket actor carries no personId, so resolve it from the user record.
      const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
      const isOwnCoach = booking.coach?.personId === me?.personId;
      if (!isOwnCoach && !can(actor.role, "manageAlaCarte")) return back("?err=auth");

      await prisma.alaCarteBooking.update({
        where: { id: bookingId },
        data: { status: decision === "ACCEPT" ? "ACCEPTED" : "DECLINED" },
      });
      await audit({ actorId: actor.userId, entityType: "AlaCarteBooking", entityId: bookingId, action: decision === "ACCEPT" ? "ACCEPT" : "DECLINE" });
      return back("?ok=respondToBooking");
    }

    // Mark a booking delivered and compute the revenue split (§0, §11). Court
    // cost comes off the top; the split is applied to net. The rate set is
    // resolved from who taught (Director vs assigned Coach) and STAMPED onto the
    // transaction so a historical payout survives a rate change. Earnings flow
    // into the coach payout.
    case "deliverBooking": {
      // Original requireAlaCarteManager(): manageAlaCarte (COO/DIRECTOR).
      if (!actor || !can(actor.role, "manageAlaCarte")) return back("?err=auth");

      const bookingId = String(formData.get("bookingId") ?? "");
      const directorTaught = formData.get("directorTaught") === "on";

      const booking = await prisma.alaCarteBooking.findUnique({
        where: { id: bookingId },
        include: { offering: { include: { facility: true } } },
      });
      if (!booking) return back("?err=notfound");

      const gross = booking.offering.priceCents;

      // Court cost: explicit input, or derived from the facility's per-hour rate
      // for a one-hour single-court slot.
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
        actorId: actor.userId, entityType: "AlaCarteBooking", entityId: bookingId, action: "DELIVER",
        summary: `Delivered; split coach ${split.coachCents} / dir ${split.directorCents} / PURE ${split.pureCents} of net ${split.netCents}`,
      });
      return back("?ok=deliverBooking");
    }

    default:
      return back("?err=op");
  }
}
