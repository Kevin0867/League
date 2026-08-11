import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { createCheckoutRedirect } from "@/lib/payments/checkout";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { SUPPORT_EMAIL } from "@/lib/payments/receipt";
import { brandedEmailHtml } from "@/lib/email/branded";

// Player-portal mutations as native-form-POST route handlers with ticket auth.
// Route handlers 303-redirect to a fresh GET (which carries the session cookie),
// so unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the portal layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

/** People this logged-in user may pay for: themselves + their dependents. */
async function householdPersonIds(personId: string | null): Promise<string[]> {
  if (!personId) return [];
  const me = await prisma.person.findUnique({
    where: { id: personId },
    include: { dependents: { select: { id: true } } },
  });
  if (!me) return [];
  return [me.id, ...me.dependents.map((d) => d.id)];
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  // The ticket only proves an authenticated user; resolve the acting person.
  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { personId: true, id: true },
  });
  const personId = me?.personId ?? null;

  const op = String(formData.get("op") ?? "");

  switch (op) {
    // Book an à la carte offering (§11). Creates a REQUESTED booking for the coach.
    case "bookOffering": {
      const offeringId = String(formData.get("offeringId") ?? "");
      const clientId = String(formData.get("clientId") ?? personId ?? "");

      const household = await householdPersonIds(personId);
      if (!household.includes(clientId)) throw new Error("Not authorized.");

      const offering = await prisma.alaCarteOffering.findUnique({ where: { id: offeringId } });
      if (!offering || !offering.active) throw new Error("Offering unavailable.");

      await prisma.alaCarteBooking.create({
        data: { offeringId, clientId, coachId: offering.coachId, status: "REQUESTED" },
      });
      return NextResponse.redirect(new URL("/portal/lessons", origin), 303);
    }

    // Player-entered availability for a fixture (§14). Player marks Playing or Not
    // playing themselves — not relayed through a coach. Scoped to the household.
    case "confirmAvailability": {
      const fixtureId = String(formData.get("fixtureId") ?? "");
      const confirmPersonId = String(formData.get("personId") ?? "");
      const status = String(formData.get("status") ?? "UNCONFIRMED");

      const household = await householdPersonIds(personId);
      if (!household.includes(confirmPersonId)) throw new Error("Not authorized.");

      await prisma.availabilityConfirmation.upsert({
        where: { fixtureId_personId: { fixtureId, personId: confirmPersonId } },
        create: { fixtureId, personId: confirmPersonId, status, confirmedAt: new Date() },
        update: { status, confirmedAt: new Date() },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    // Mark a received message as read for the current user's household.
    case "markMessageRead": {
      const recipientId = String(formData.get("recipientId") ?? "");
      const household = await householdPersonIds(personId);
      // Only mark rows that belong to this household.
      await prisma.messageRecipient.updateMany({
        where: { id: recipientId, personId: { in: household }, readAt: null },
        data: { readAt: new Date(), inAppStatus: "READ" },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    case "markMessageUnread": {
      const recipientId = String(formData.get("recipientId") ?? "");
      const household = await householdPersonIds(personId);
      await prisma.messageRecipient.updateMany({
        where: { id: recipientId, personId: { in: household } },
        data: { readAt: null, inAppStatus: "DELIVERED" },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    case "deleteMessage": {
      const recipientId = String(formData.get("recipientId") ?? "");
      const household = await householdPersonIds(personId);
      // Remove only this household's copy of the announcement.
      await prisma.messageRecipient.deleteMany({
        where: { id: recipientId, personId: { in: household } },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    case "markAllMessagesRead": {
      const household = await householdPersonIds(personId);
      await prisma.messageRecipient.updateMany({
        where: { personId: { in: household }, readAt: null },
        data: { readAt: new Date(), inAppStatus: "READ" },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    case "clearReadMessages": {
      const household = await householdPersonIds(personId);
      await prisma.messageRecipient.deleteMany({
        where: { personId: { in: household }, readAt: { not: null } },
      });
      return NextResponse.redirect(new URL("/portal", origin), 303);
    }

    /**
     * Begin checkout for a requested payment. Uses Stripe hosted checkout when
     * configured; otherwise simulates a completed payment so the flow is
     * demonstrable in dev. The no-make-up policy disclosure is shown on the payment
     * screen and reaffirmed here in the line-item description (§8).
     */
    case "startCheckout": {
      // Never let a payment failure become a blank error page. Any problem
      // redirects back to the portal with a specific, human reason.
      const payerr = (code: string) => NextResponse.redirect(new URL(`/portal?payerr=${code}`, origin), 303);
      const paymentId = String(formData.get("paymentId") ?? "");
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.direction !== "IN") return payerr("notfound");

      // Authorization: the payment's party must be in the caller's household.
      const household = await householdPersonIds(personId);
      if (!payment.partyId || !household.includes(payment.partyId)) return payerr("auth");
      if (payment.status === "PAID") return NextResponse.redirect(new URL("/portal?paid=1", origin), 303);

      const plan = String(formData.get("plan") ?? "full") === "installments" ? "installments" : "full";
      const result = await createCheckoutRedirect({ paymentId: payment.id, plan, actorId: actor.userId });
      if (!result.ok) {
        if (result.error === "paid") return NextResponse.redirect(new URL("/portal?paid=1", origin), 303);
        return payerr(result.error === "stripe" ? "stripe" : "notfound");
      }
      return NextResponse.redirect(result.redirectUrl, 303);
    }

    // Lesson / clinic request — emailed to the team inbox for follow-up (§11).
    case "requestLesson": {
      const f = (k: string) => String(formData.get(k) ?? "").trim();
      const list = (k: string) => formData.getAll(k).map((v) => String(v).trim()).filter(Boolean);

      const contactName = f("contactName") || "A player";
      const contactEmail = f("contactEmail");
      const contactPhone = f("contactPhone");
      const forWho = f("forWho");
      const rating = f("rating");
      const lessonType = f("lessonType");
      const coachPreference = f("coachPreference");
      const locations = list("location");
      const dayTimes = list("dayTime");
      const dayTimeOther = f("dayTimeOther");
      const notes = f("notes");

      const lines = [
        `New lesson request from ${contactName}.`,
        ``,
        `Contact: ${contactEmail || "—"}${contactPhone ? ` · ${contactPhone}` : ""}`,
        `For: ${forWho || "—"}`,
        `Skill / rating: ${rating || "—"}`,
        `Lesson type: ${lessonType || "—"}`,
        `Preferred coach: ${coachPreference || "No preference — match available"}`,
        `Locations: ${locations.length ? locations.join(", ") : "—"}`,
        `Day/time preferences: ${[...dayTimes, dayTimeOther].filter(Boolean).join(", ") || "—"}`,
        ``,
        `Notes: ${notes || "—"}`,
      ];
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const rowsHtml = [
        ["Contact", `${contactEmail || "—"}${contactPhone ? ` · ${contactPhone}` : ""}`],
        ["For", forWho || "—"],
        ["Skill / rating", rating || "—"],
        ["Lesson type", lessonType || "—"],
        ["Preferred coach", coachPreference || "No preference — match available"],
        ["Locations", locations.length ? locations.join(", ") : "—"],
        ["Day/time", [...dayTimes, dayTimeOther].filter(Boolean).join(", ") || "—"],
        ["Notes", notes || "—"],
      ]
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:34%;vertical-align:top">${k}</td>` +
            `<td style="padding:6px 0;color:#0f172a;font-size:14px">${esc(String(v))}</td></tr>`
        )
        .join("");
      const lessonHtml = brandedEmailHtml({
        heading: "New lesson request",
        intro: `From ${esc(contactName)}`,
        contentHtml: `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:6px 16px"><table style="width:100%;border-collapse:collapse">${rowsHtml}</table></div>`,
      });
      await sendEmail(SUPPORT_EMAIL, `Lesson request — ${contactName}`, lines.join("\n"), lessonHtml);
      await audit({ actorId: actor.userId, entityType: "LessonRequest", entityId: personId ?? "unknown", action: "REQUESTED", summary: `Lesson request emailed to ${SUPPORT_EMAIL}` });
      return NextResponse.redirect(new URL("/portal/lessons?sent=1", origin), 303);
    }

    default:
      return NextResponse.redirect(new URL("/portal", origin), 303);
  }
}
