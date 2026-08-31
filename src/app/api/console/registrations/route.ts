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
import { personContacts, filterToContacts } from "@/lib/domain/contacts";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { signWaiverToken, placementWaiverLink } from "@/lib/domain/waiverRenewal";
import { appUrl } from "@/lib/stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { TEAM_CAP } from "@/lib/enums";
import { accruePlayerSeasonFee, placementPayLink } from "@/lib/payments/familyFee";
import { syncRefundsForCharge } from "@/lib/payments/refunds";
import { teamLaunchEmail } from "@/lib/domain/launchEmail";
import { welcomeEmail } from "@/lib/domain/welcomeEmail";
import { describeTeamPractice } from "@/lib/domain/practiceInfo";
import { decryptField } from "@/lib/crypto";

// Console registration actions: add a walk-in player, and per-registrant roster
// quick-actions (assign/move to a team, send back to the pool, request the
// season fee, start a refund). Ticket-authorized route handler with the shared
// 303-redirect pattern (see /api/console/facilities).
export const dynamic = "force-dynamic";

/** Minimal HTML escaper for admin-supplied text injected into an email body. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Team ids for a season (used to enforce one-team-per-season on assign/move). */
async function seasonTeamIds(seasonId: string): Promise<string[]> {
  const teams = await prisma.team.findMany({ where: { seasonId }, select: { id: true } });
  return teams.map((t) => t.id);
}

/**
 * Place one person on a team as a move: drop them from any other team in the
 * same season, upsert the membership, and mark their registration ASSIGNED.
 * Shared by assignToTeam and assignPair so both behave identically.
 */
async function placeOnTeam(personId: string, teamId: string, seasonId: string) {
  const ids = (await seasonTeamIds(seasonId)).filter((id) => id !== teamId);
  if (ids.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: ids } } });
  await prisma.teamMember.upsert({
    where: { teamId_personId: { teamId, personId } },
    create: { teamId, personId, roleOnTeam: "PLAYER" },
    update: {},
  });
  await prisma.registration.updateMany({
    where: { personId, seasonId, status: { not: "ASSIGNED" } },
    data: { status: "ASSIGNED" },
  });
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
  const pay = await placementPayLink(personId, seasonId);
  const waiver = await placementWaiverLink(personId);
  const practiceWhen = await describeTeamPractice(team, seasonId);
  const email = teamAssignmentEmail({
    name: person?.firstName ?? "there",
    teamId: team.id,
    teamName: team.name,
    coachName,
    coachContact,
    locationName: team.facility?.name ?? "To be confirmed",
    locationAddress: team.facility?.exactAddress ?? team.facility?.generalArea ?? null,
    practiceWhen,
    payUrl: pay?.payUrl ?? null,
    feeCents: pay?.feeCents ?? null,
    waiverUrl: waiver.waiverUrl,
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
): { subject: string; text: string; html: string; sms: string } {
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

// Resolve hand-picked "Send to" recipients for a person (and their guardian,
// for a minor), validated against real contacts. `picked` is empty when the
// caller didn't show a checklist (e.g. the list-view quick resend) — callers
// then fall back to sending to all addresses on file.
async function pickedRecipients(personId: string, submitted: string[]): Promise<{ contacts: number; picked: string[] }> {
  const person = await prisma.person.findUnique({ where: { id: personId }, include: { guardian: true } });
  if (!person) return { contacts: 0, picked: [] };
  const contacts = personContacts(person, person.isMinor ? person.guardian : null);
  return { contacts: contacts.length, picked: filterToContacts(submitted, contacts) };
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
    // Optional intake details — program interest, ranked location markets,
    // practice-time preference, and free-text notes.
    const programInterest = String(fd.get("programInterest") ?? "").trim() || null;
    const practiceTimePref = String(fd.get("practiceTimePref") ?? "").trim() || null;
    const partnerRequests = String(fd.get("notes") ?? "").trim() || null;
    const locationPrefs = [String(fd.get("locationPref1") ?? ""), String(fd.get("locationPref2") ?? ""), String(fd.get("locationPref3") ?? "")]
      .map((m) => m.trim())
      .filter(Boolean)
      .map((marketName, i) => ({ marketName, rank: i + 1 }));
    if (!firstName || !lastName) return back("?err=name");
    if (!email && !phone) return back("?err=contact");
    try {
      await ingestRegistration({ firstName, lastName, email, phone, dob, divisionId, seasonId, programInterest, practiceTimePref, partnerRequests, locationPrefs, source: "console" });
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
      // Resend goes by email + text (no new in-app announcement — re-nudging
      // shouldn't pile up duplicates in the portal).
      const res = await dispatchMessage({
        senderId: actor.userId, seasonId: pay.seasonId ?? seasonScope ?? "", audienceType: "SINGLE_PERSON", audienceRef: pay.partyId,
        channels: ["EMAIL", "SMS"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html, smsBody: email.sms,
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
    // Optional urgent note prepended to every reminder (e.g. a deadline push).
    const note = String(fd.get("note") ?? "").trim().slice(0, 400);
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
      // Prepend the urgent note (if any) to each channel so it leads the message.
      const text = note ? `${note}\n\n${email.text}` : email.text;
      const sms = note ? `${note} ${email.sms}`.slice(0, 480) : email.sms;
      const html = note
        ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;margin:0 0 16px;color:#9a3412;font-weight:600">${escapeHtml(note)}</div>${email.html}`
        : email.html;
      // Per-payment address picks from the reminder list (name="to_<paymentId>").
      // Empty → fan out to all of the payer's addresses.
      const { picked } = await pickedRecipients(pay.partyId, fd.getAll(`to_${pay.id}`).map((v) => String(v)));
      const res = await dispatchMessage({
        senderId: actor.userId, seasonId: pay.seasonId ?? "", audienceType: "SINGLE_PERSON", audienceRef: pay.partyId,
        channels: ["EMAIL", "SMS"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: text, html, smsBody: sms,
        ...(picked.length ? { toEmails: picked } : {}),
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

  // Bulk-send the waiver to everyone in the selected registrations — the
  // "127 clicks → 1" action from the registrations grid. ids = registrationIds
  // (deduped to one waiver per person).
  if (op === "bulkSendWaiver") {
    const regIds = fd.getAll("ids").map((v) => String(v)).filter(Boolean);
    const regs = await prisma.registration.findMany({ where: { id: { in: regIds } }, select: { personId: true, seasonId: true } });
    const seenPerson = new Set<string>();
    let sent = 0;
    for (const r of regs) {
      if (seenPerson.has(r.personId)) continue;
      seenPerson.add(r.personId);
      const person = await prisma.person.findUnique({ where: { id: r.personId } });
      if (!person) continue;
      const { contacts } = await pickedRecipients(r.personId, []);
      if (contacts === 0) continue;
      const token = await signWaiverToken(person.id);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const email = waiverRequestEmail({ name: person.firstName, link, isMinor: person.isMinor });
      await dispatchMessage({
        senderId: actor.userId, seasonId: r.seasonId, audienceType: "SINGLE_PERSON", audienceRef: person.id,
        channels: ["IN_APP", "EMAIL"], triggerType: "WAIVER_REQUEST", subject: email.subject, body: email.text, html: email.html,
      });
      sent++;
    }
    await audit({ actorId: actor.userId, entityType: "Person", entityId: "bulk", action: "WAIVER_REQUESTED_BULK", summary: `Sent waiver to ${sent} player(s)` });
    return back(`?ok=bulkWaiver&n=${sent}`);
  }

  // Bulk-request the season fee for every selected registration.
  if (op === "bulkRequestFee") {
    const ids = fd.getAll("ids").map((v) => String(v)).filter(Boolean);
    const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
    const feeCents = rate?.seasonFeeCents ?? 49500;
    let sent = 0;
    for (const rid of ids) {
      const r = await prisma.registration.findUnique({ where: { id: rid }, include: { person: true, season: true } });
      if (!r) continue;
      const res = await accruePlayerSeasonFee({ playerId: r.personId, seasonId: r.seasonId, feeCents, seasonName: r.season?.name ?? "Season" });
      const [payer, payment] = await Promise.all([
        prisma.person.findUnique({ where: { id: res.payerId } }),
        prisma.payment.findUnique({ where: { id: res.paymentId } }),
      ]);
      if (payer && payment) {
        const email = paymentRequestEmail({ name: payer.firstName, amountCents: payment.amountCents, description: payment.description ?? `${r.season?.name ?? "Season"} season fee`, paymentId: payment.id });
        await dispatchMessage({
          senderId: actor.userId, seasonId: r.seasonId, audienceType: "SINGLE_PERSON", audienceRef: res.payerId,
          channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html, smsBody: email.sms,
        });
      }
      sent++;
    }
    await audit({ actorId: actor.userId, entityType: "Payment", entityId: "bulk", action: "REQUESTED_BULK", summary: `Requested fee for ${sent} player(s)` });
    return back(`?ok=bulkFee&n=${sent}`);
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
      // Assignment is SILENT by design: players/parents are never messaged just
      // for being placed. Staff control who and when — messaging goes out later,
      // deliberately, from the team Launch flow (welcome + fee + waiver) or the
      // explicit "Resend assignment email" action. Notify only on opt-in.
      if (String(fd.get("notify") ?? "") === "1") await notifyAssignment(teamId, personId, team.seasonId);
      if (String(fd.get("from") ?? "") === "requests")
        return NextResponse.redirect(new URL(`/console/requests?ok=${override ? "override" : "assign"}`, origin), 303);
      return back("?ok=assign");
    }

    // Place two players (a requester and a matched friend/sibling) on the same
    // team in one action — the "Place both on…" control on the requests page.
    // Honors a pairing request by moving both, cap-checked for the pair at once.
    case "assignPair": {
      const teamId = String(fd.get("teamId") ?? "");
      const partnerPersonId = String(fd.get("partnerPersonId") ?? "");
      if (!partnerPersonId) return NextResponse.redirect(new URL(`/console/requests?err=fields`, origin), 303);
      const team = teamId
        ? await prisma.team.findUnique({ where: { id: teamId }, include: { _count: { select: { members: true } } } })
        : null;
      if (!team) return NextResponse.redirect(new URL(`/console/requests?err=team`, origin), 303);

      const people = personId === partnerPersonId ? [personId] : [personId, partnerPersonId];
      // Seats we're actually adding = pair members not already on this team.
      const existing = await prisma.teamMember.findMany({ where: { teamId, personId: { in: people } } });
      const adding = people.filter((id) => !existing.some((m) => m.personId === id)).length;
      const override = String(fd.get("override") ?? "") === "1";
      if (!override && team._count.members + (team.coachPlays ? 1 : 0) + adding > TEAM_CAP) {
        return NextResponse.redirect(new URL(`/console/requests?err=cap`, origin), 303);
      }

      for (const pid of people) await placeOnTeam(pid, teamId, team.seasonId);
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN", summary: `Placed pair on team: ${people.join(" + ")}` });
      // Silent by design — see assignToTeam. Placement never auto-messages.
      if (String(fd.get("notify") ?? "") === "1")
        for (const pid of people) await notifyAssignment(teamId, pid, team.seasonId);
      return NextResponse.redirect(new URL(`/console/requests?ok=${override ? "override" : "assign"}`, origin), 303);
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
    // Per-player season-fee invoice (billed to the paying adult), then emailed.
    case "requestFee": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");

      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const season = await prisma.season.findUnique({ where: { id: reg.seasonId } });
      const seasonName = season?.name ?? "Season";

      const res = await accruePlayerSeasonFee({ playerId: personId, seasonId: reg.seasonId, feeCents, seasonName });

      const [payer, payment] = await Promise.all([
        prisma.person.findUnique({ where: { id: res.payerId } }),
        prisma.payment.findUnique({ where: { id: res.paymentId } }),
      ]);
      if (payer && payment) {
        const email = paymentRequestEmail({ name: payer.firstName, amountCents: payment.amountCents, description: payment.description ?? `${seasonName} season fee`, paymentId: payment.id });
        await dispatchMessage({
          senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: res.payerId,
          channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html, smsBody: email.sms,
        });
      }
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: res.paymentId, action: "REQUESTED", summary: `Fee ${res.created ? "requested" : "re-sent"} for ${person.firstName} ${person.lastName}` });
      return back("?ok=fee");
    }

    // Email the player (or a minor's parent/guardian) a tokenized, no-login link
    // to complete the participation waiver. Their record updates on signing.
    case "sendWaiver": {
      if (!actor) return back("?err=auth");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");
      const { contacts, picked } = await pickedRecipients(personId, fd.getAll("to").map((v) => String(v)));
      if (contacts === 0) return back("?err=noemail");

      const token = await signWaiverToken(person.id);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const email = waiverRequestEmail({ name: person.firstName, link, isMinor: person.isMinor });
      await dispatchMessage({
        senderId: actor.userId, seasonId: reg?.seasonId ?? null, audienceType: "SINGLE_PERSON", audienceRef: person.id,
        channels: ["IN_APP", "EMAIL"], triggerType: "WAIVER_REQUEST",
        subject: email.subject, body: email.text, html: email.html,
        ...(picked.length ? { toEmails: picked } : {}),
      });
      await audit({ actorId: actor.userId, entityType: "Person", entityId: person.id, action: "WAIVER_REQUESTED", summary: "Waiver request sent" });
      return back("?ok=waiverSent");
    }

    // Remove a registration entirely — a mistaken or withdrawn signup. Pulls the
    // person off every team in that registration's season first (so no ghost on a
    // roster), then deletes the registration; its location preferences cascade
    // away via the FK. The Person and any payment history are kept — a person may
    // hold other registrations, waivers, or be a parent — and financial records
    // are never silently destroyed.
    case "deleteRegistration": {
      if (!actor) return back("?err=auth");
      if (!reg) return back("?err=notfound");
      const seasonTeams = await seasonTeamIds(reg.seasonId);
      if (seasonTeams.length) {
        await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: seasonTeams } } });
      }
      await prisma.registration.delete({ where: { id: reg.id } });
      await audit({
        actorId: actor.userId,
        entityType: "Registration",
        entityId: reg.id,
        action: "DELETE",
        summary: `Removed registration for ${personId}; pulled from ${seasonTeams.length ? "season teams" : "no teams"}`,
      });
      // The detail page is gone now — land on the list with a confirmation.
      return NextResponse.redirect(new URL(`/console/registrations?ok=regDeleted`, origin), 303);
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
          emailLabel: nn("emailLabel"),
          email2Label: nn("email2Label"),
          email3Label: nn("email3Label"),
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

    // Split this registration onto its OWN person record. Fixes families where
    // two registrations (e.g. a parent and a child) ended up sharing one contact
    // record — so renaming one would rename both. Clones the shared person into a
    // fresh record, re-points THIS registration (and its team assignment) to the
    // clone, and leaves the other registration on the original person. The admin
    // can then edit the new record's name and contact independently.
    case "splitPerson": {
      if (!reg) return back("?err=fields");
      const source = await prisma.person.findUnique({ where: { id: personId } });
      if (!source) return back("?err=fields");
      // Nothing to split if this is the person's only registration.
      const regCount = await prisma.registration.count({ where: { personId } });
      if (regCount < 2) return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?err=nosplit`, origin), 303);

      // Encrypted-at-rest fields must be handed to the write layer as plaintext,
      // or the encryption extension would double-encrypt the already-ciphertext
      // value. decryptField returns a sentinel when the value can't be read on
      // this key; drop it rather than copy garbage.
      const decClone = (v: string | null) => {
        if (!v) return null;
        const d = decryptField(v);
        return d === "[unable to decrypt]" ? null : d;
      };

      const clone = await prisma.person.create({
        data: {
          firstName: source.firstName,
          lastName: source.lastName,
          dob: source.dob,
          email: source.email,
          email2: source.email2,
          email3: source.email3,
          emailLabel: source.emailLabel,
          email2Label: source.email2Label,
          email3Label: source.email3Label,
          phone: source.phone,
          gender: source.gender,
          howHeard: source.howHeard,
          isMinor: source.isMinor,
          guardianId: source.guardianId,
          mediaOptOut: source.mediaOptOut,
          waiverSignedAt: source.waiverSignedAt,
          emailConsentAt: source.emailConsentAt,
          smsConsentAt: source.smsConsentAt,
          waiverRenewalRequiredAt: source.waiverRenewalRequiredAt,
          duprId: source.duprId,
          duprRating: source.duprRating,
          duprVerified: source.duprVerified,
          duprVerifiedAt: source.duprVerifiedAt,
          duprParentalConsent: source.duprParentalConsent,
          // Encrypted fields — pass decrypted plaintext so they re-encrypt cleanly.
          address: decClone(source.address),
          emergencyName: decClone(source.emergencyName),
          emergencyPhone: decClone(source.emergencyPhone),
          emergencyRelation: decClone(source.emergencyRelation),
          medicalNotes: decClone(source.medicalNotes),
          // Deliberately NOT copied: stripeCustomerId / zohoSyncedAt / imageUrl —
          // the split record starts its own billing + sync identity.
        },
      });

      // Move this registration to the clone.
      await prisma.registration.update({ where: { id: reg.id }, data: { personId: clone.id } });

      // Move the team assignment that belongs to this registration (matched by the
      // registration's division within the season) so the roster follows the split.
      const memberships = await prisma.teamMember.findMany({
        where: { personId, team: { seasonId: reg.seasonId } },
        include: { team: { select: { divisionId: true } } },
      });
      let toMove = reg.divisionId ? memberships.find((m) => m.team.divisionId === reg.divisionId) ?? null : null;
      if (!toMove && memberships.length === 1) toMove = memberships[0];
      if (toMove) await prisma.teamMember.update({ where: { id: toMove.id }, data: { personId: clone.id } });

      await audit({
        actorId: actor.userId,
        entityType: "Registration",
        entityId: reg.id,
        action: "SPLIT_PERSON",
        summary: `Split registration onto its own record (was shared with another registration under ${source.firstName} ${source.lastName})`,
      });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=split`, origin), 303);
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

    // SEND ALL — one combined email + SMS to this player's household: welcome +
    // team details (if placed), pick apparel & pay their season fee, and complete
    // the waiver. Per-player: charges only this player. Can be sent at any time —
    // no team, payment, or placement is required; unknown team details show as
    // "to be confirmed".
    case "launchRegistration": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");

      const ids = await seasonTeamIds(reg.seasonId);
      const membership = ids.length
        ? await prisma.teamMember.findFirst({
            where: { personId, teamId: { in: ids } },
            include: { team: { include: { facility: true, coach: { include: { person: true } } } } },
          })
        : null;
      const team = membership?.team ?? null;

      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const season = await prisma.season.findUnique({ where: { id: reg.seasonId } });
      const seasonName = season?.name ?? "Season";
      const payerId = person.guardianId ?? person.id;

      // This player's own invoice (unless their registration is fee-waived).
      const res = reg.feeWaived ? null : await accruePlayerSeasonFee({ playerId: person.id, seasonId: reg.seasonId, feeCents, seasonName });
      const payUrl = res ? `${appUrl()}/pay/${res.paymentId}` : null;

      const payer = await prisma.person.findUnique({ where: { id: payerId } });
      if (!payer) return back("?err=fields");

      const coachName = team?.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
      const coachContact = team?.coach ? [team.coach.person.email, team.coach.person.phone].filter(Boolean).join(" · ") || null : null;
      const practiceWhen = team ? await describeTeamPractice(team, reg.seasonId) : "To be confirmed";
      // Always include the participation-waiver link so anyone unsigned is caught.
      const waiverUrl = `${appUrl()}/waiver/sign?token=${encodeURIComponent(await signWaiverToken(payerId))}`;

      const email = teamLaunchEmail({
        recipientName: payer.firstName,
        teamName: team?.name ?? "PURE Academy",
        players: [`${person.firstName} ${person.lastName}`],
        coachName,
        coachContact,
        locationName: team?.facility?.name ?? "To be confirmed",
        locationAddress: team?.facility?.exactAddress ?? team?.facility?.generalArea ?? null,
        practiceWhen,
        payUrl: payUrl ?? `${appUrl()}/portal`,
        feeCents,
        waiverUrl,
      });
      const smsBody = `PURE Academy — welcome${team ? ` to ${team.name}` : ""}! ${team ? `Practices: ${practiceWhen}. ` : ""}${payUrl ? `Pick your team apparel & pay the season fee here: ${payUrl} ` : ""}Full details + your waiver are in your email.`;
      await dispatchMessage({
        senderId: actor.userId,
        seasonId: reg.seasonId,
        audienceType: "SINGLE_PERSON",
        audienceRef: payerId,
        channels: ["IN_APP", "EMAIL", "SMS"],
        triggerType: "TEAM_LAUNCH",
        subject: email.subject,
        body: email.text,
        html: email.html,
        smsBody,
      });
      await audit({ actorId: actor.userId, entityType: "Registration", entityId: reg.id, action: "LAUNCH", summary: `Sent all to ${person.firstName} ${person.lastName}'s family — welcome + fee + waiver` });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=sentall`, origin), 303);
    }

    // WELCOME — send just the welcome/placement note any time. If the player is
    // on a team it's the placement email (team, coach, location, day/time); if
    // not, a generic PURE Academy welcome. No gating.
    case "sendWelcome": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");
      const ids = await seasonTeamIds(reg.seasonId);
      const membership = ids.length ? await prisma.teamMember.findFirst({ where: { personId, teamId: { in: ids } } }) : null;
      if (membership) {
        await notifyAssignment(membership.teamId, personId, reg.seasonId, { emailOnly: false });
      } else {
        const email = welcomeEmail({ recipientName: person.guardianId ? "there" : person.firstName, playerName: `${person.firstName} ${person.lastName}` });
        await dispatchMessage({
          senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON",
          audienceRef: person.guardianId ?? person.id, channels: ["IN_APP", "EMAIL"], triggerType: "TEAM_ASSIGNMENT",
          subject: email.subject, body: email.text, html: email.html,
        });
      }
      await audit({ actorId: actor.userId, entityType: "Registration", entityId: reg.id, action: "RESEND", summary: `Welcome sent to ${person.firstName} ${person.lastName}` });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=welcomeSent`, origin), 303);
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
      // Hand-picked recipients from the detail-page checklist; the list-view
      // quick resend sends to every address on file (picked empty → fan-out).
      const { picked } = await pickedRecipients(personId, fd.getAll("to").map((v) => String(v)));
      // Resend goes by email + text (no new in-app announcement — see resendAllFees).
      await dispatchMessage({
        senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
        channels: ["EMAIL", "SMS"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html, smsBody: email.sms,
        ...(picked.length ? { toEmails: picked } : {}),
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

      const original = { id: pay.id, partyId: pay.partyId, seasonId: pay.seasonId, amountCents: pay.amountCents, status: pay.status, description: pay.description };
      if (isStripeConfigured() && pay.stripePaymentIntentId) {
        try {
          const refund = await stripe().refunds.create({ payment_intent: pay.stripePaymentIntentId });
          const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? null;
          if (chargeId) {
            const charge = await stripe().charges.retrieve(chargeId);
            // Books the OUT/REFUND row (idempotent by refund id) and marks the
            // original REFUNDED when fully refunded — same path the webhook uses.
            await syncRefundsForCharge(original, charge.id, charge.amount, charge.amount_refunded);
          }
        } catch {
          return back("?err=refundfail");
        }
      } else {
        // No Stripe — simulate the booking so the ledger still balances in dev.
        await prisma.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED" } });
        await prisma.payment.create({
          data: {
            direction: "OUT", partyId: personId, amountCents: pay.amountCents, method: "STRIPE",
            status: "PAID", category: "REFUND", seasonId: reg.seasonId, paidAt: new Date(),
            description: `Refund — ${pay.description ?? "season fee"} [simulated]`,
          },
        });
      }
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "REFUNDED", summary: "Refund issued" });
      return back("?ok=refund");
    }

    default:
      return back("?err=op");
  }
}
