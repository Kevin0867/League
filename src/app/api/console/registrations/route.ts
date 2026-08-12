import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { ingestRegistration } from "@/lib/domain/intake";
import { dispatchMessage } from "@/lib/messaging";
import { sendEmail } from "@/lib/notify";
import { teamAssignmentEmail } from "@/lib/domain/assignmentEmail";
import { paymentRequestEmail } from "@/lib/payments/paymentRequestEmail";
import { customPaymentEmailContent } from "@/lib/payments/customPaymentEmail";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { appUrl } from "@/lib/stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { TEAM_CAP } from "@/lib/enums";
import { accrueFamilySeasonFee } from "@/lib/payments/familyFee";

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

async function notifyAssignment(teamId: string, personId: string, seasonId: string, opts?: { emailOnly?: boolean }) {
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
    channels: opts?.emailOnly ? ["EMAIL"] : ["IN_APP", "EMAIL"], triggerType: "TEAM_ASSIGNMENT",
    subject: email.subject, body: email.text, html: email.html,
  });
}

// Reminder-eligible categories: any inbound charge we'd nudge someone about.
// (REFUND/COACH_PAYOUT are outbound and never reminded.)
const REMINDABLE_CATEGORIES = ["PLAYER_FEE", "ALA_CARTE", "CUSTOM", "ACP_ENTRY", "FACILITY_FEE"] as const;

// Build the right reminder email for a payment. A season fee gets the full
// two-CTA (pay-in-full / 3-payments) template; everything else — a private
// lesson, an ACP entry, a custom charge — gets the single "Pay now" template,
// so a $20 lesson never receives a "your season fee reserves a place on a team,
// pay in 3 installments" email.
function reminderEmailFor(
  pay: { id: string; amountCents: number; description: string | null; category: string },
  person: { firstName: string }
): { subject: string; text: string; html: string } {
  if (pay.category === "PLAYER_FEE") {
    return paymentRequestEmail({
      name: person.firstName,
      amountCents: pay.amountCents,
      description: pay.description ?? "Season fee",
      paymentId: pay.id,
    });
  }
  return customPaymentEmailContent({
    name: person.firstName,
    amountCents: pay.amountCents,
    description: pay.description ?? "Payment due",
    paymentId: pay.id,
  });
}

// Running tally for a bulk reminder run, so the UI can report exactly what
// happened: how many actually went out, how many failed (with a sample error),
// how many were only simulated (provider unconfigured), and how many were
// skipped for having no payer/email on file.
type ReminderTally = { sent: number; failed: number; simulated: number; skipped: number; reason: string };
function newTally(): ReminderTally {
  return { sent: 0, failed: 0, simulated: 0, skipped: 0, reason: "" };
}
function reminderResultQuery(t: ReminderTally): string {
  const qs = new URLSearchParams({ ok: "resentAll", n: String(t.sent) });
  if (t.failed) qs.set("failed", String(t.failed));
  if (t.simulated) qs.set("sim", String(t.simulated));
  if (t.skipped) qs.set("skipped", String(t.skipped));
  if (t.reason) qs.set("reason", t.reason.slice(0, 180));
  return qs.toString();
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

  // Bulk-resend outstanding fee requests — scoped to a team's roster (teamId set)
  // or everyone with an unpaid request (no teamId). Does not create new charges.
  if (op === "resendAllFees") {
    if (!can(actor.role, "manageTeams")) return back("?err=auth");
    const teamId = String(fd.get("teamId") ?? "").trim();
    let partyIds: string[] | undefined;
    let seasonScope: string | undefined;
    if (teamId) {
      const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } });
      if (!team) return NextResponse.redirect(new URL(`/console/teams/${teamId}?err=notfound`, origin), 303);
      partyIds = team.members.map((m) => m.personId);
      seasonScope = team.seasonId;
      if (partyIds.length === 0) return NextResponse.redirect(new URL(`/console/teams/${teamId}?ok=resentAll&n=0`, origin), 303);
    }
    const payments = await prisma.payment.findMany({
      where: {
        direction: "IN",
        category: { in: [...REMINDABLE_CATEGORIES] },
        status: { in: ["REQUESTED", "PENDING"] },
        ...(partyIds ? { partyId: { in: partyIds } } : {}),
        ...(seasonScope ? { seasonId: seasonScope } : {}),
      },
    });
    const tally = newTally();
    for (const pay of payments) {
      if (!pay.partyId) { tally.skipped++; if (!tally.reason) tally.reason = "a charge had no payer on file"; continue; }
      const person = await prisma.person.findUnique({ where: { id: pay.partyId } });
      if (!person) { tally.skipped++; if (!tally.reason) tally.reason = "a payer record was missing"; continue; }
      const email = reminderEmailFor(pay, person);
      // Resend = email only. The original request already posted an in-app
      // announcement; re-nudging shouldn't pile up duplicates in the portal.
      const res = await dispatchMessage({
        senderId: actor.userId, seasonId: pay.seasonId ?? seasonScope ?? "", audienceType: "SINGLE_PERSON", audienceRef: pay.partyId,
        channels: ["EMAIL"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html,
      });
      if (res.failures > 0) {
        tally.failed++;
        if (!tally.reason && res.failureReasons[0]) tally.reason = `${person.firstName} ${person.lastName}: ${res.failureReasons[0]}`;
      } else if (res.simulated > 0) {
        tally.simulated++;
        if (!tally.reason) tally.reason = "email provider not configured — nothing was actually delivered";
      } else {
        tally.sent++;
      }
    }
    await audit({ actorId: actor.userId, entityType: "Payment", entityId: teamId || "all", action: "RESEND_BULK", summary: `Resent ${tally.sent} fee request(s)${tally.failed ? `, ${tally.failed} failed` : ""}${tally.simulated ? `, ${tally.simulated} simulated` : ""}` });
    const q = reminderResultQuery(tally);
    const dest = teamId ? `/console/teams/${teamId}?${q}` : `/console/payments?${q}`;
    return NextResponse.redirect(new URL(dest, origin), 303);
  }

  // Resend fee reminders to a hand-picked set of recipients (from the Payments
  // consolidated reminder view). Email-only, like resendAllFees.
  if (op === "resendSelectedFees") {
    if (!can(actor.role, "manageTeams")) return back("?err=auth");
    const ids = fd.getAll("paymentId").map((v) => String(v)).filter(Boolean);
    if (ids.length === 0) return NextResponse.redirect(new URL("/console/payments?ok=resentAll&n=0", origin), 303);
    const payments = await prisma.payment.findMany({
      where: {
        id: { in: ids },
        direction: "IN",
        category: { in: [...REMINDABLE_CATEGORIES] },
        status: { in: ["REQUESTED", "PENDING"] },
      },
    });
    const tally = newTally();
    for (const pay of payments) {
      if (!pay.partyId) { tally.skipped++; if (!tally.reason) tally.reason = "a charge had no payer on file"; continue; }
      const person = await prisma.person.findUnique({ where: { id: pay.partyId } });
      if (!person) { tally.skipped++; if (!tally.reason) tally.reason = "a payer record was missing"; continue; }
      const email = reminderEmailFor(pay, person);
      const res = await dispatchMessage({
        senderId: actor.userId, seasonId: pay.seasonId ?? "", audienceType: "SINGLE_PERSON", audienceRef: pay.partyId,
        channels: ["EMAIL"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html,
      });
      if (res.failures > 0) {
        tally.failed++;
        if (!tally.reason && res.failureReasons[0]) tally.reason = `${person.firstName} ${person.lastName}: ${res.failureReasons[0]}`;
      } else if (res.simulated > 0) {
        tally.simulated++;
        if (!tally.reason) tally.reason = "email provider not configured — nothing was actually delivered";
      } else {
        tally.sent++;
      }
    }
    await audit({ actorId: actor.userId, entityType: "Payment", entityId: "selected", action: "RESEND_BULK", summary: `Resent ${tally.sent} selected fee request(s)${tally.failed ? `, ${tally.failed} failed` : ""}${tally.simulated ? `, ${tally.simulated} simulated` : ""}` });
    return NextResponse.redirect(new URL(`/console/payments?${reminderResultQuery(tally)}`, origin), 303);
  }

  // Send a sample fee-request email to the signed-in admin, so staff can preview
  // exactly what families receive (independent of the BCC setting).
  if (op === "sendTestPayment") {
    if (!can(actor.role, "manageTeams")) return back("?err=auth");
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, include: { person: true } });
    if (!me?.email) return NextResponse.redirect(new URL(`/console/payments?err=noemail`, origin), 303);
    const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
    const feeCents = rate?.seasonFeeCents ?? 49500;
    const sample = paymentRequestEmail({
      name: me.person?.firstName ?? "there",
      amountCents: feeCents,
      description: "Sample — season fee preview",
      paymentId: "sample",
    });
    const res = await sendEmail(me.email, `[Preview] ${sample.subject}`, sample.text, sample.html);
    await audit({ actorId: actor.userId, entityType: "Payment", entityId: "preview", action: "TEST_EMAIL", summary: res.ok ? (res.simulated ? `Preview simulated (provider unconfigured) for ${me.email}` : `Sent preview fee request to ${me.email}`) : `Preview to ${me.email} failed: ${res.error}` });
    if (!res.ok) {
      return NextResponse.redirect(new URL(`/console/payments?err=sendfail&reason=${encodeURIComponent((res.error ?? "send failed").slice(0, 180))}`, origin), 303);
    }
    if (res.simulated) {
      return NextResponse.redirect(new URL(`/console/payments?ok=testsim`, origin), 303);
    }
    return NextResponse.redirect(new URL(`/console/payments?ok=testsent`, origin), 303);
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
      // Cap is a soft limit for admins: they may exceed TEAM_CAP with override=1
      // (e.g. to honor a "play with my friend" request onto a full team). Only
      // reachable here because manageTeams is already enforced above (admin-only).
      const override = String(fd.get("override") ?? "") === "1";
      if (!alreadyOn && !override && team._count.members + (team.coachPlays ? 1 : 0) + 1 > TEAM_CAP) return back("?err=cap");

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
      if (String(fd.get("from") ?? "") === "requests")
        return NextResponse.redirect(new URL(`/console/requests?ok=${override ? "override" : "assign"}`, origin), 303);
      return back("?ok=assign");
    }

    // Board: drop a player into a division pool — unassign from any team and set
    // that division (empty = unplaced). Keeps them in the assignment pool.
    case "repool": {
      if (!reg) return back("?err=fields");
      const divisionId = String(fd.get("divisionId") ?? "") || null;
      const market = String(fd.get("market") ?? "").trim();
      const ids = await seasonTeamIds(reg.seasonId);
      if (ids.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: ids } } });
      await prisma.registration.update({ where: { id: reg.id }, data: { divisionId, status: "SUBMITTED" } });
      // Moving into a location pool sets that market as their top preference.
      if (market) {
        await prisma.locationPreference.deleteMany({ where: { registrationId: reg.id } });
        await prisma.locationPreference.create({ data: { registrationId: reg.id, marketName: market, rank: 1 } });
      }
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
    // Rolls up to the household invoice so a family sees one consolidated total.
    case "requestFee": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");

      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const season = await prisma.season.findUnique({ where: { id: reg.seasonId } });
      const seasonName = season?.name ?? "Season";

      const res = await accrueFamilySeasonFee({ playerId: personId, seasonId: reg.seasonId, feeCents, seasonName });
      if (!res) return back("?ok=feeexists");

      const [payer, payment] = await Promise.all([
        prisma.person.findUnique({ where: { id: res.payerId } }),
        prisma.payment.findUnique({ where: { id: res.paymentId } }),
      ]);
      if (payer && payment) {
        const email = paymentRequestEmail({ name: payer.firstName, amountCents: payment.amountCents, description: payment.description ?? `${seasonName} season fee`, paymentId: payment.id });
        await dispatchMessage({
          senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: res.payerId,
          channels: ["IN_APP", "EMAIL"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html,
        });
      }
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: res.paymentId, action: "REQUESTED", summary: "Fee requested (household invoice)" });
      return back("?ok=fee");
    }

    // Email the player (or a minor's parent/guardian) a tokenized, no-login link
    // to complete the participation waiver. Their record updates on signing.
    case "sendWaiver": {
      if (!actor) return back("?err=auth");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");
      if (!person.email) return back("?err=noemail");

      const token = await signWaiverToken(person.id);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const email = waiverRequestEmail({ name: person.firstName, link, isMinor: person.isMinor });
      await dispatchMessage({
        senderId: actor.userId, seasonId: reg?.seasonId ?? null, audienceType: "SINGLE_PERSON", audienceRef: person.id,
        channels: ["IN_APP", "EMAIL"], triggerType: "WAIVER_REQUEST",
        subject: email.subject, body: email.text, html: email.html,
      });
      await audit({ actorId: actor.userId, entityType: "Person", entityId: person.id, action: "WAIVER_REQUESTED", summary: "Waiver request sent" });
      return back("?ok=waiverSent");
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
          email2: nn("email2"),
          email3: nn("email3"),
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
      await notifyAssignment(membership.teamId, personId, reg.seasonId, { emailOnly: true });
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
      // Resend = email only (no new in-app announcement — see resendAllFees).
      await dispatchMessage({
        senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
        channels: ["EMAIL"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html,
      });
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "RESEND", summary: "Resent fee request" });
      const dest = String(fd.get("from") ?? "") === "list"
        ? `/console/registrations?ok=resent`
        : `/console/registrations/${reg.id}?ok=resent`;
      return NextResponse.redirect(new URL(dest, origin), 303);
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
