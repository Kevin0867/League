import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { ingestRegistration } from "@/lib/domain/intake";
import { dispatchMessage } from "@/lib/messaging";
import { teamAssignmentEmail } from "@/lib/domain/assignmentEmail";
import { paymentRequestEmail } from "@/lib/payments/paymentRequestEmail";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { TEAM_CAP } from "@/lib/enums";

// Console registration actions: add a walk-in player, and per-registrant roster
// quick-actions (assign/move to a team, send back to the pool, request the
// season fee, start a refund). Ticket-authorized route handler with the shared
// 303-redirect pattern (see /api/console/facilities).
export const dynamic = "force-dynamic";

/** Team ids for a season (used to enforce one-team-per-season on assign/move). */
async function seasonTeamIds(seasonId: string): Promise<string[]> {
  const teams = await prisma.team.findMany({ where: { seasonId }, select: { id: true } });
  return teams.map((t) => t.id);
}

async function notifyAssignment(teamId: string, personId: string, seasonId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { facility: true, coach: { include: { person: true } }, members: { include: { person: true } } },
  });
  if (!team) return;
  const person = team.members.find((m) => m.personId === personId)?.person;
  const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
  const coachContact = [team.coach?.person.email, team.coach?.person.phone].filter(Boolean).join(" · ") || null;
  const email = teamAssignmentEmail({
    name: person?.firstName ?? "there",
    teamId: team.id,
    teamName: team.name,
    coachName,
    coachContact,
    locationName: team.facility?.name ?? "To be confirmed",
    locationAddress: team.facility?.exactAddress ?? team.facility?.generalArea ?? null,
    practiceWhen: team.dayOfWeek ? `${team.dayOfWeek}${team.startTime ? ` at ${team.startTime}` : ""}` : "A day and time to be confirmed",
  });
  await dispatchMessage({
    seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
    channels: ["IN_APP", "EMAIL"], triggerType: "TEAM_ASSIGNMENT",
    subject: email.subject, body: email.text, html: email.html,
  });
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/registrations${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");
  const op = String(fd.get("op") ?? "");

  // Add a walk-in player through the shared intake path (dedup + all fields).
  if (op === "addPlayer") {
    if (!can(actor.role, "managePlayers")) return back("?err=auth");
    const firstName = String(fd.get("firstName") ?? "").trim();
    const lastName = String(fd.get("lastName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim() || null;
    const phone = String(fd.get("phone") ?? "").trim() || null;
    const dob = String(fd.get("dob") ?? "").trim() || null;
    const divisionId = String(fd.get("divisionId") ?? "").trim() || null;
    const seasonId = String(fd.get("seasonId") ?? "").trim() || null;
    if (!firstName || !lastName) return back("?err=name");
    if (!email && !phone) return back("?err=contact");
    try {
      await ingestRegistration({ firstName, lastName, email, phone, dob, divisionId, seasonId, source: "console" });
    } catch {
      return back("?err=failed");
    }
    return back("?ok=addPlayer");
  }

  // The roster quick-actions require team-management rights.
  if (!can(actor.role, "manageTeams")) return back("?err=auth");
  const personId = String(fd.get("personId") ?? "");
  const registrationId = String(fd.get("registrationId") ?? "");
  if (!personId) return back("?err=fields");
  const reg = registrationId ? await prisma.registration.findUnique({ where: { id: registrationId } }) : null;

  switch (op) {
    // Assign or move: enforce one team per season, then place on the chosen team.
    case "assignToTeam": {
      const teamId = String(fd.get("teamId") ?? "");
      const team = teamId
        ? await prisma.team.findUnique({ where: { id: teamId }, include: { _count: { select: { members: true } } } })
        : null;
      if (!team) return back("?err=team");

      const alreadyOn = await prisma.teamMember.findUnique({ where: { teamId_personId: { teamId, personId } } });
      if (!alreadyOn && team._count.members + (team.coachPlays ? 1 : 0) + 1 > TEAM_CAP) return back("?err=cap");

      // Remove from any other team in the same season (this makes it a move).
      const ids = (await seasonTeamIds(team.seasonId)).filter((id) => id !== teamId);
      if (ids.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: ids } } });

      await prisma.teamMember.upsert({
        where: { teamId_personId: { teamId, personId } },
        create: { teamId, personId, roleOnTeam: "PLAYER" },
        update: {},
      });
      await prisma.registration.updateMany({
        where: { personId, seasonId: team.seasonId, status: { not: "ASSIGNED" } },
        data: { status: "ASSIGNED" },
      });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN", summary: `Assigned/moved ${personId}` });
      // The board moves players provisionally; it sets silent=1 so a placement
      // email isn't fired on every drag (staff send it explicitly afterward).
      if (String(fd.get("silent") ?? "") !== "1") await notifyAssignment(teamId, personId, team.seasonId);
      return back("?ok=assign");
    }

    // Board: drop a player into a division pool — unassign from any team and set
    // that division (empty = unplaced). Keeps them in the assignment pool.
    case "repool": {
      if (!reg) return back("?err=fields");
      const divisionId = String(fd.get("divisionId") ?? "") || null;
      const ids = await seasonTeamIds(reg.seasonId);
      if (ids.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: ids } } });
      await prisma.registration.update({ where: { id: reg.id }, data: { divisionId, status: "SUBMITTED" } });
      await audit({ actorId: actor.userId, entityType: "Registration", entityId: reg.id, action: "REPOOL", summary: "Moved to pool / division" });
      return back("?ok=repool");
    }

    // Send a player back to the pool for their season.
    case "unassign": {
      if (!reg) return back("?err=fields");
      const ids = await seasonTeamIds(reg.seasonId);
      if (ids.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: ids } } });
      await prisma.registration.updateMany({
        where: { personId, seasonId: reg.seasonId, status: "ASSIGNED" },
        data: { status: "SUBMITTED" },
      });
      await audit({ actorId: actor.userId, entityType: "Registration", entityId: reg.id, action: "UNASSIGN", summary: "Sent back to pool" });
      return back("?ok=unassign");
    }

    // Request the season fee from this one player (single-person version of §8).
    case "requestFee": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");
      const existing = await prisma.payment.findFirst({
        where: { partyId: personId, seasonId: reg.seasonId, category: "PLAYER_FEE", status: { in: ["REQUESTED", "PENDING", "PAID"] } },
      });
      if (existing) return back("?ok=feeexists");

      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const season = await prisma.season.findUnique({ where: { id: reg.seasonId } });
      const description = `${season?.name ?? "Season"} fee`;
      const payment = await prisma.payment.create({
        data: { direction: "IN", partyId: personId, amountCents: feeCents, method: "STRIPE", status: "REQUESTED", category: "PLAYER_FEE", seasonId: reg.seasonId, description },
      });
      const email = paymentRequestEmail({ name: person.firstName, amountCents: feeCents, description, paymentId: payment.id });
      await dispatchMessage({
        senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
        channels: ["IN_APP", "EMAIL"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html,
      });
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: payment.id, action: "REQUESTED", summary: "Fee requested" });
      return back("?ok=fee");
    }

    // Edit the registration + the player's core details from the detail page.
    case "editRegistration": {
      if (!reg) return back("?err=fields");
      const g = (k: string) => String(fd.get(k) ?? "").trim();
      const nn = (k: string) => g(k) || null;
      const cents = (k: string) => (g(k) ? Math.round(parseFloat(g(k)) * 100) : null);

      // Waiver: keep an existing signed date; set now when newly checked; clear when unchecked.
      const existingPerson = await prisma.person.findUnique({ where: { id: personId }, select: { waiverSignedAt: true } });
      const waiverChecked = fd.get("waiverSigned") === "on";
      const waiverSignedAt = waiverChecked ? existingPerson?.waiverSignedAt ?? new Date() : null;

      await prisma.person.update({
        where: { id: personId },
        data: {
          firstName: g("firstName") || undefined,
          lastName: g("lastName") || undefined,
          email: nn("email"),
          phone: nn("phone"),
          dob: g("dob") ? new Date(g("dob")) : null,
          gender: nn("gender"),
          address: nn("address"),
          howHeard: nn("howHeard"),
          stripeCustomerId: nn("stripeCustomerId"),
          waiverSignedAt,
          // Encrypted fields: only write when a value is supplied, so a blank
          // (e.g. undecryptable on this key) never clobbers existing ciphertext.
          ...(g("emergencyName") ? { emergencyName: g("emergencyName") } : {}),
          ...(g("emergencyPhone") ? { emergencyPhone: g("emergencyPhone") } : {}),
          ...(g("medical") ? { medicalNotes: g("medical") } : {}),
        },
      });
      await prisma.registration.update({
        where: { id: reg.id },
        data: {
          divisionId: nn("divisionId"),
          skillLevel: nn("skillLevel"),
          programInterest: nn("programInterest"),
          practiceTimePref: nn("practiceTimePref"),
          schedule: nn("schedule"),
          partnerRequests: nn("partnerRequests"),
          daysThatDontWork: nn("daysThatDontWork"),
          perClassRateCents: cents("perClassRate"),
          enrollmentFeeCents: cents("enrollmentFee"),
          sourceStatus: nn("sourceStatus"),
          stripeSubscriptionId: nn("stripeSubscriptionId"),
          ...(g("submittedAt") ? { submittedAt: new Date(g("submittedAt")) } : {}),
          ...(g("status") ? { status: g("status") } : {}),
        },
      });

      // Location preferences — replace from the ranked market dropdowns.
      const markets = [1, 2, 3].map((i) => g(`locationPref${i}`)).filter(Boolean);
      const seen = new Set<string>();
      await prisma.locationPreference.deleteMany({ where: { registrationId: reg.id } });
      let rank = 1;
      for (const m of markets) {
        if (seen.has(m)) continue;
        seen.add(m);
        await prisma.locationPreference.create({ data: { registrationId: reg.id, marketName: m, rank: rank++ } });
      }

      await audit({ actorId: actor.userId, entityType: "Registration", entityId: reg.id, action: "UPDATE", summary: "Edited registration" });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=edit`, origin), 303);
    }

    // Resend the team-assignment email for a currently-assigned player.
    case "resendAssignment": {
      if (!reg) return back("?err=fields");
      const ids = await seasonTeamIds(reg.seasonId);
      const membership = ids.length
        ? await prisma.teamMember.findFirst({ where: { personId, teamId: { in: ids } } })
        : null;
      if (!membership) return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?err=notassigned`, origin), 303);
      await notifyAssignment(membership.teamId, personId, reg.seasonId);
      await audit({ actorId: actor.userId, entityType: "Registration", entityId: reg.id, action: "RESEND", summary: "Resent assignment email" });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=resent`, origin), 303);
    }

    // Resend the season-fee request email for an outstanding payment.
    case "resendPayment": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      const pay = await prisma.payment.findFirst({
        where: { partyId: personId, seasonId: reg.seasonId, category: "PLAYER_FEE", status: { in: ["REQUESTED", "PENDING"] } },
        orderBy: { createdAt: "desc" },
      });
      if (!person || !pay) return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?err=nopayment`, origin), 303);
      const email = paymentRequestEmail({ name: person.firstName, amountCents: pay.amountCents, description: pay.description ?? "Season fee", paymentId: pay.id });
      await dispatchMessage({
        senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
        channels: ["IN_APP", "EMAIL"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html,
      });
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "RESEND", summary: "Resent fee request" });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=resent`, origin), 303);
    }

    // Start a refund on this player's paid season fee.
    case "refund": {
      if (!reg) return back("?err=fields");
      const pay = await prisma.payment.findFirst({
        where: { partyId: personId, seasonId: reg.seasonId, category: "PLAYER_FEE", status: "PAID" },
        orderBy: { paidAt: "desc" },
      });
      if (!pay) return back("?err=norefund");

      let simulated = false;
      if (isStripeConfigured() && pay.stripePaymentIntentId) {
        try {
          await stripe().refunds.create({ payment_intent: pay.stripePaymentIntentId });
        } catch {
          return back("?err=refundfail");
        }
      } else {
        simulated = true;
      }
      await prisma.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED" } });
      await prisma.payment.create({
        data: {
          direction: "OUT", partyId: personId, amountCents: pay.amountCents, method: "STRIPE",
          status: "PAID", category: "REFUND", seasonId: reg.seasonId, paidAt: new Date(),
          description: `Refund — ${pay.description ?? "season fee"}${simulated ? " [simulated]" : ""}`,
        },
      });
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "REFUNDED", summary: `Refund started${simulated ? " (simulated)" : ""}` });
      return back("?ok=refund");
    }

    default:
      return back("?err=op");
  }
}
