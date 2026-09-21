import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { ingestRegistration } from "@/lib/domain/intake";
import { dispatchMessage } from "@/lib/messaging";
import { sendEmail, sendSms } from "@/lib/notify";
import { paymentRequestEmail } from "@/lib/payments/paymentRequestEmail";
import { customPaymentEmailContent } from "@/lib/payments/customPaymentEmail";
import { personContacts, filterToContacts } from "@/lib/domain/contacts";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { appUrl } from "@/lib/stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { TEAM_CAP } from "@/lib/enums";
import { accruePlayerSeasonFee, splitFamilyFee, ensureSeasonFeePayable } from "@/lib/payments/familyFee";
import { sendTeamLaunch } from "@/lib/domain/teamLaunch";
import { feeStateOf } from "@/lib/domain/feeStatus";
import { syncRefundsForCharge } from "@/lib/payments/refunds";
import { welcomeEmail } from "@/lib/domain/welcomeEmail";
import { notifyTeamAssignment } from "@/lib/domain/teamAssignmentNotify";
import { decryptField } from "@/lib/crypto";
import { sendResetLinkForPerson } from "@/lib/domain/passwordResetSend";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { ageFromDob } from "@/lib/domain/messaging-acl";

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
/** Was this player already on a team in the season BEFORE this placement? Used to
 *  fire the welcome/launch on FIRST placement only (so moves don't re-spam). */
async function wasPlacedInSeason(personId: string, seasonId: string): Promise<boolean> {
  const ids = await seasonTeamIds(seasonId);
  if (!ids.length) return false;
  const m = await prisma.teamMember.findFirst({ where: { personId, teamId: { in: ids } }, select: { id: true } });
  return !!m;
}

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
  // Placement (incl. off the waitlist) clears them to pay — ensure their
  // season-fee invoice exists so the fee + apparel are payable immediately.
  await ensureSeasonFeePayable(personId, seasonId);
}

// A player's team-assignment note (team, coach, location, practice time, pay +
// waiver links) — shared so every placement path can send it. See the domain module.
const notifyAssignment = notifyTeamAssignment;

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

  // Add a TRIAL player to a team — try-before-you-pay. Handled here (not in the
  // switch below) because a new trial player has no personId yet, and the switch
  // requires one. Creates/reuses the person, files a trial registration, puts
  // them on the team, and texts/emails a waiver + account link. No fee charged.
  // Allowed for an admin, or a coach of that team (courtside sign-up).
  if (op === "addTrial") {
    const teamId = String(fd.get("teamId") ?? "").trim();
    const team = teamId ? await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, seasonId: true, divisionId: true, name: true } }) : null;
    if (!team) return back("?err=fields");
    const isAdminActor = can(actor.role, "managePlayers");
    const coachesTeam = isAdminActor || (await coachedTeamIdsForUser(actor.userId)).includes(teamId);
    if (!coachesTeam) return back("?err=auth");

    const first = String(fd.get("firstName") ?? "").trim();
    const last = String(fd.get("lastName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim().toLowerCase() || null;
    const phone = String(fd.get("phone") ?? "").trim() || null;
    const dobStr = String(fd.get("dob") ?? "").trim();
    const backTo = String(fd.get("returnTo") ?? "").trim();
    const bounce = (qs: string) => NextResponse.redirect(new URL(`${backTo.startsWith("/") ? backTo : `/console/teams/${teamId}`}${qs}`, origin), 303);
    if (!first || !last) return bounce("?err=trialname");
    if (!email && !phone) return bounce("?err=trialcontact");

    const dob = dobStr ? new Date(dobStr) : null;
    const age = dob && !isNaN(dob.getTime()) ? ageFromDob(dob) : null;
    const isMinor = age !== null ? age < 18 : false;

    // Person + trial registration + roster spot in one transaction — all-or-
    // nothing, so a failure can't leave an orphan person that "shows up nowhere".
    let newPersonId: string;
    try {
      newPersonId = await prisma.$transaction(async (tx) => {
        const existingPerson = email ? await tx.person.findFirst({ where: { email, NOT: { isMinor: true } }, select: { id: true } }) : null;
        const pid = existingPerson
          ? existingPerson.id
          : (await tx.person.create({
              data: { firstName: first, lastName: last, email, phone, dob: dob && !isNaN(dob.getTime()) ? dob : null, isMinor },
              select: { id: true },
            })).id;
        if (existingPerson && phone) await tx.person.update({ where: { id: pid }, data: { phone } });

        const existingReg = await tx.registration.findFirst({ where: { personId: pid, seasonId: team.seasonId }, select: { id: true } });
        if (existingReg) await tx.registration.update({ where: { id: existingReg.id }, data: { trial: true, status: "ASSIGNED" } });
        else await tx.registration.create({ data: { personId: pid, seasonId: team.seasonId, divisionId: team.divisionId, status: "ASSIGNED", trial: true, programInterest: "Trial" } });

        const tm = await tx.teamMember.findFirst({ where: { teamId, personId: pid }, select: { id: true } });
        if (!tm) await tx.teamMember.create({ data: { teamId, personId: pid, roleOnTeam: "PLAYER" } });
        return pid;
      });
    } catch (e) {
      console.error("addTrial create failed", e);
      return bounce(`?err=trialfailed&why=${encodeURIComponent((e instanceof Error ? e.message : "failed").slice(0, 140))}`);
    }

    // Notify the player so they can sign the waiver: waiver link (essential) plus
    // an account set-up link, by email AND text, capturing what actually sent.
    let emailedOk = false;
    let textedOk = false;
    let sendErr: string | null = null;
    try {
      const token = await signWaiverToken(newPersonId);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const em = waiverRequestEmail({ name: first, link, isMinor });
      if (email) {
        const r = await sendEmail(email, em.subject, em.text, em.html);
        if (r.ok) emailedOk = true; else sendErr = r.error ?? "email failed";
      }
      if (phone) {
        const r = await sendSms(phone, `PURE Academy — welcome${first ? `, ${first}` : ""}! Please complete your participation waiver before your trial class: ${link}`);
        if (r.ok) textedOk = true; else sendErr = r.error ?? "text failed";
      }
    } catch (e) {
      sendErr = e instanceof Error ? e.message : "send failed";
    }
    const reset = await sendResetLinkForPerson(newPersonId).catch(() => null);
    const accountSent = !!(reset && reset.ok);

    await audit({ actorId: actor.userId, entityType: "Person", entityId: newPersonId, action: "registration.addTrial", summary: `Added trial player ${first} ${last} to ${team.name} (waiver ${emailedOk || textedOk ? "sent" : "NOT sent"})` });
    const channels = [emailedOk ? "email" : null, textedOk ? "text" : null].filter(Boolean).join(" & ");
    if (emailedOk || textedOk) return bounce(`?ok=trialadded&via=${encodeURIComponent(channels)}${accountSent ? "&acct=1" : ""}`);
    return bounce(`?ok=trialadded&nomsg=1${sendErr ? `&why=${encodeURIComponent(sendErr.slice(0, 120))}` : ""}`);
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
    const payments = (await prisma.payment.findMany({
      where: {
        direction: "IN",
        category: { in: [...REMINDABLE_CATEGORIES] },
        status: { in: ["REQUESTED", "PENDING"] },
        ...(partyIds ? { partyId: { in: partyIds } } : {}),
        ...(seasonScope ? { seasonId: seasonScope } : {}),
      },
      // Don't dun a family that's on the 3-payment plan and paying on schedule —
      // an active subscription is not an unpaid fee.
    })).filter((pay) => feeStateOf(pay) !== "subscription");
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
    // Prepend the urgent note (if typed) so the preview shows the EXACT message
    // families will get — email banner + text — before sending to everyone.
    const note = String(fd.get("note") ?? "").trim().slice(0, 400);
    const text = note ? `${note}\n\n${sample.text}` : sample.text;
    const html = note
      ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;margin:0 0 16px;color:#9a3412;font-weight:600">${escapeHtml(note)}</div>${sample.html}`
      : sample.html;
    // Send to the addresses the admin typed, falling back to their own account.
    const testEmail = String(fd.get("testEmail") ?? "").trim().toLowerCase() || me.email;
    const testPhone = String(fd.get("testPhone") ?? "").trim() || (me.person?.phone?.trim() ?? "");
    const res = await sendEmail(testEmail, `[Preview] ${sample.subject}`, text, html);
    // Text the SMS version too, so the whole message can be verified (the real
    // blast sends email + SMS). Report exactly what happened per channel.
    let sms: "sent" | "sim" | "none" | "fail" = "none";
    if (testPhone) {
      const smsText = note ? `${note} ${sample.sms}`.slice(0, 480) : sample.sms;
      const r = await sendSms(testPhone, `[Preview] ${smsText}`).catch(() => ({ ok: false, simulated: false } as { ok: boolean; simulated: boolean }));
      sms = r.ok ? (r.simulated ? "sim" : "sent") : "fail";
    }
    await audit({ actorId: actor.userId, entityType: "Payment", entityId: "preview", action: "TEST_EMAIL", summary: res.ok ? (res.simulated ? `Preview simulated for ${testEmail}` : `Sent preview to ${testEmail}`) + ` · text: ${sms}` : `Preview to ${testEmail} failed: ${res.error}` });
    if (!res.ok) {
      return NextResponse.redirect(new URL(`/console/payments?err=sendfail&reason=${encodeURIComponent((res.error ?? "send failed").slice(0, 180))}`, origin), 303);
    }
    const qs = new URLSearchParams({ ok: res.simulated ? "testsim" : "testsent", to: testEmail, sms });
    if (testPhone) qs.set("tel", testPhone);
    return NextResponse.redirect(new URL(`/console/payments?${qs.toString()}`, origin), 303);
  }

  // Request the season fee + apparel from one player via a chosen channel —
  // email, text, or both. Works from the team roster (no need to open the player)
  // and the registration record. Ensures the fee invoice exists first, then sends
  // the pay link (which is the fee + apparel page). Reports which channel went out.
  if (op === "requestPayment") {
    if (!can(actor.role, "manageTeams")) return back("?err=auth");
    const pid = String(fd.get("personId") ?? "");
    const rawReturn = String(fd.get("returnTo") ?? "");
    const rt = rawReturn.startsWith("/console/") ? rawReturn : "/console/registrations";
    const backRT = (qs: string) => NextResponse.redirect(new URL(`${rt}${qs}`, origin), 303);
    if (!pid) return backRT("?err=fields");
    const ch = String(fd.get("channel") ?? "both");
    const channels = ch === "text" ? (["SMS"] as const) : ch === "email" ? (["EMAIL"] as const) : (["EMAIL", "SMS"] as const);

    // Resolve the season: explicit, or from the team the request came from.
    let seasonId = String(fd.get("seasonId") ?? "");
    const teamId = String(fd.get("teamId") ?? "");
    if (!seasonId && teamId) seasonId = (await prisma.team.findUnique({ where: { id: teamId }, select: { seasonId: true } }))?.seasonId ?? "";
    if (!seasonId) return backRT("?err=fields");

    const person = await prisma.person.findUnique({ where: { id: pid }, select: { firstName: true, lastName: true } });
    if (!person) return backRT("?err=fields");

    // Make sure there's an invoice to point at (accrue if missing), then find it.
    await ensureSeasonFeePayable(pid, seasonId);
    const pay = await prisma.payment.findFirst({
      where: {
        seasonId,
        category: "PLAYER_FEE",
        status: { in: ["REQUESTED", "PENDING"] },
        OR: [{ partyId: pid }, { coveredPersonIds: { array_contains: pid } }],
      },
      orderBy: { createdAt: "desc" },
    });
    if (!pay) return backRT("?err=nopayment");

    const payer = pay.partyId ? await prisma.person.findUnique({ where: { id: pay.partyId }, select: { firstName: true } }) : null;
    const email = paymentRequestEmail({ name: payer?.firstName ?? person.firstName, amountCents: pay.amountCents, description: pay.description ?? "Season fee", paymentId: pay.id });
    const res = await dispatchMessage({
      senderId: actor.userId, seasonId, audienceType: "SINGLE_PERSON", audienceRef: pid,
      channels: [...channels], triggerType: "PAYMENT_REQUEST",
      subject: email.subject, body: email.text, html: email.html, smsBody: email.sms,
    });
    await audit({ actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "RESEND", summary: `Requested fee + apparel via ${ch} for ${person.firstName} ${person.lastName}` });

    const qs = new URLSearchParams({ ok: "reqpay", via: ch, who: `${person.firstName} ${person.lastName}` });
    if (res.failures > 0) qs.set("reqfail", "1");
    else if (res.simulated > 0) qs.set("reqsim", "1");
    return backRT(`?${qs.toString()}`);
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

      // First placement (not already on any team this season) → auto-welcome.
      const firstPlacement = !(await wasPlacedInSeason(personId, team.seasonId));
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
      // Placement (incl. off the waitlist) clears them to pay — ensure a
      // season-fee invoice exists so the fee + apparel are payable right away.
      await ensureSeasonFeePayable(personId, team.seasonId);
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN", summary: `Assigned/moved ${personId}` });
      // On FIRST placement, auto-send the full welcome (team details + pay the
      // fee + pick apparel + complete the waiver). A move between teams doesn't
      // re-send — the admin can opt in with notify=1 for the lighter placement note.
      // First placement gets the full welcome; a MOVE sends the team-info note
      // (team, coach, location, practice day/time, pay + waiver links) so the
      // player always gets their new team details — unless the bulk board asks to
      // stay silent while arranging (silent=1).
      if (firstPlacement) await sendTeamLaunch({ personId, seasonId: team.seasonId, senderId: actor.userId });
      else if (String(fd.get("silent") ?? "") !== "1") await notifyAssignment(teamId, personId, team.seasonId);
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

      // Which of the pair are being placed for the FIRST time this season.
      const firstTimers = new Set<string>();
      for (const pid of people) if (!(await wasPlacedInSeason(pid, team.seasonId))) firstTimers.add(pid);
      for (const pid of people) await placeOnTeam(pid, teamId, team.seasonId);
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN", summary: `Placed pair on team: ${people.join(" + ")}` });
      // First placement → full welcome; a move → team-info note by default (so
      // the player gets their new team details), unless told to stay silent.
      const silentPair = String(fd.get("silent") ?? "") === "1";
      for (const pid of people) {
        if (firstTimers.has(pid)) await sendTeamLaunch({ personId: pid, seasonId: team.seasonId, senderId: actor.userId });
        else if (!silentPair) await notifyAssignment(teamId, pid, team.seasonId);
      }
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
      // Honor a caller-supplied return path (e.g. the person record) so the admin
      // lands back where they acted; otherwise the registration detail page.
      const rawReturnRF = String(fd.get("returnTo") ?? "");
      const rtRF = rawReturnRF.startsWith("/console/") ? rawReturnRF : null;
      const backRF = (qs: string) => NextResponse.redirect(new URL(`${rtRF ?? (reg ? `/console/registrations/${reg.id}` : "/console/registrations")}${qs}`, origin), 303);
      if (!reg) return backRF("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return backRF("?err=fields");

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
      return backRF("?ok=fee");
    }

    // Set a CUSTOM (e.g. discounted) season fee for this player and optionally
    // send the pay request. It sets the player's actual season-fee invoice to the
    // given amount — so when paid (online or offline) the season shows fully paid
    // at what they really owe, not the standard rate.
    case "setSeasonFee": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");
      const amountRaw = String(fd.get("amount") ?? "").trim();
      const cents = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : NaN;
      if (!Number.isFinite(cents) || cents < 0) return back(`/${reg.id}?err=amount`);
      const season = await prisma.season.findUnique({ where: { id: reg.seasonId }, select: { name: true } });
      const seasonName = season?.name ?? "Season";

      const covering = await prisma.payment.findMany({
        where: { seasonId: reg.seasonId, category: "PLAYER_FEE", OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }] },
        orderBy: { createdAt: "desc" },
      });
      if (covering.some((x) => x.status === "PAID")) return back(`/${reg.id}?err=alreadypaid`);

      let paymentId: string;
      let payerId: string;
      const target = covering.find((x) => ["REQUESTED", "PENDING", "FAILED"].includes(x.status));
      if (target) {
        // Reprice the existing unpaid invoice to the custom amount.
        await prisma.payment.update({ where: { id: target.id }, data: { amountCents: cents } });
        paymentId = target.id;
        payerId = target.partyId ?? personId;
      } else {
        // No invoice yet — create the season fee at exactly this amount.
        const res = await accruePlayerSeasonFee({ playerId: personId, seasonId: reg.seasonId, feeCents: cents, seasonName, prorate: false });
        paymentId = res.paymentId;
        payerId = res.payerId;
      }
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: paymentId, action: "REQUESTED", summary: `Custom season fee $${(cents / 100).toFixed(2)} set for ${person.firstName} ${person.lastName}` });

      // Optionally send the pay request now.
      if (fd.get("send") != null) {
        const [payer, payment] = await Promise.all([
          prisma.person.findUnique({ where: { id: payerId } }),
          prisma.payment.findUnique({ where: { id: paymentId } }),
        ]);
        if (payer && payment) {
          const email = paymentRequestEmail({ name: payer.firstName, amountCents: payment.amountCents, description: payment.description ?? `${seasonName} season fee`, paymentId: payment.id });
          await dispatchMessage({
            senderId: actor.userId, seasonId: reg.seasonId, audienceType: "SINGLE_PERSON", audienceRef: payerId,
            channels: ["IN_APP", "EMAIL", "SMS"], triggerType: "PAYMENT_REQUEST", subject: email.subject, body: email.text, html: email.html, smsBody: email.sms,
          }).catch(() => {});
        }
        return back(`/${reg.id}?ok=feesetsent`);
      }
      return back(`/${reg.id}?ok=feeset`);
    }

    // Mark a fee PAID outside Stripe — a check, Class Wallet, cash, or an in-kind
    // credit. Records HOW it was paid from a free-text note. Settles the player's
    // outstanding (or partially-paid subscription) invoice; if no fee has been
    // invoiced yet, one is accrued first so the payment has something to land on.
    case "markPaidOffline": {
      const rawReturnMP = String(fd.get("returnTo") ?? "");
      const rtMP = rawReturnMP.startsWith("/console/") ? rawReturnMP : null;
      const backMP = (qs: string) => NextResponse.redirect(new URL(`${rtMP ?? (reg ? `/console/registrations/${reg.id}` : "/console/registrations")}${qs}`, origin), 303);
      if (!reg) return backMP("?err=fields");
      const note = String(fd.get("note") ?? "").trim().slice(0, 300);
      if (!note) return backMP("?err=nonote");
      // The dollar amount actually received offline. Blank falls back to the
      // invoice amount; a bad or non-positive figure is rejected.
      const amountRaw = String(fd.get("amount") ?? "").trim();
      const enteredCents = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : null;
      if (amountRaw && (!Number.isFinite(enteredCents) || (enteredCents ?? 0) <= 0)) {
        return backMP("?err=amount");
      }
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return backMP("?err=fields");

      // Find the fee covering this player that isn't already settled/refunded —
      // an outstanding request, a failed charge, or a subscription still paying.
      const covering = await prisma.payment.findMany({
        where: {
          seasonId: reg.seasonId,
          category: "PLAYER_FEE",
          OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (covering.some((x) => x.status === "PAID")) {
        return backMP("?err=alreadypaid");
      }
      let target = covering.find((x) => ["REQUESTED", "PENDING", "FAILED"].includes(x.status));
      if (!target) {
        // No invoice yet — accrue one (get-or-create, consolidated per payer) so
        // the offline payment records against a real fee.
        const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
        const feeCents = rate?.seasonFeeCents ?? 49500;
        const season = await prisma.season.findUnique({ where: { id: reg.seasonId }, select: { name: true } });
        const res = await accruePlayerSeasonFee({ playerId: personId, seasonId: reg.seasonId, feeCents, seasonName: season?.name ?? "Season" });
        target = (await prisma.payment.findUnique({ where: { id: res.paymentId } })) ?? undefined;
      }
      if (!target) return backMP("?err=fields");

      const settledCents = enteredCents ?? target.amountCents;
      await prisma.payment.update({
        where: { id: target.id },
        data: {
          status: "PAID",
          method: "MANUAL",
          paidAt: new Date(),
          manualNote: note,
          // Record the actual amount received, so the Payments "Collected" total
          // reflects what was really paid (may differ from the invoiced amount).
          amountCents: settledCents,
          // If this was on the 3-payment plan, settling it offline completes it.
          ...(target.installmentPlan ? { installmentsPaid: target.installmentsTotal ?? 3 } : {}),
        },
      });
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: target.id, action: "PAID", summary: `Marked paid offline — ${(settledCents / 100).toFixed(2)} (${note}) for ${person.firstName} ${person.lastName}` });
      return backMP("?ok=paidoffline");
    }

    // Mark a fee as PAYING BY PLAN (subscription) — for a player who set up a
    // Stripe 3-payment plan that the app lost the link to (e.g. the fee row was
    // re-created by a split/re-request while the Stripe subscription kept billing).
    // Records installmentPlan + how many of the 3 have cleared, so the player
    // reads "✓ subscription" everywhere, matching the money in Stripe.
    case "markSubscription": {
      if (!reg) return back("?err=fields");
      const paidN = Math.max(1, Math.min(3, parseInt(String(fd.get("installmentsPaid") ?? "1"), 10) || 1));
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return back("?err=fields");

      const covering = await prisma.payment.findMany({
        where: {
          seasonId: reg.seasonId,
          category: "PLAYER_FEE",
          OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (covering.some((x) => x.status === "PAID")) {
        return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?err=alreadypaid`, origin), 303);
      }
      let target = covering.find((x) => ["REQUESTED", "PENDING", "FAILED"].includes(x.status));
      if (!target) {
        const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
        const feeCents = rate?.seasonFeeCents ?? 49500;
        const season = await prisma.season.findUnique({ where: { id: reg.seasonId }, select: { name: true } });
        const res = await accruePlayerSeasonFee({ playerId: personId, seasonId: reg.seasonId, feeCents, seasonName: season?.name ?? "Season" });
        target = (await prisma.payment.findUnique({ where: { id: res.paymentId } })) ?? undefined;
      }
      if (!target) return back("?err=fields");

      const done = paidN >= 3;
      await prisma.payment.update({
        where: { id: target.id },
        data: {
          installmentPlan: true,
          installmentsTotal: 3,
          installmentsPaid: paidN,
          // All 3 in → fully PAID; otherwise it's an active plan (PENDING).
          status: done ? "PAID" : "PENDING",
          ...(done ? { paidAt: target.paidAt ?? new Date() } : {}),
        },
      });
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: target.id, action: done ? "PAID" : "SCHEDULED", summary: `Marked as subscription — ${paidN}/3 paid for ${person.firstName} ${person.lastName}` });
      return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?ok=subscription`, origin), 303);
    }

    // Waive the season fee — "no charge ($0)". For coaches who play on their own
    // team (or anyone comped): set Registration.feeWaived so no future placement
    // re-invoices them, and settle any outstanding season-fee invoice that covers
    // ONLY this player at $0 so it reads "paid" everywhere and stops chasing them.
    // A shared family invoice is never zeroed (it still covers real payers).
    // "unwaiveFee" clears the flag; it does not un-settle a $0 invoice.
    case "waiveFee":
    case "unwaiveFee": {
      const rawReturnWF = String(fd.get("returnTo") ?? "");
      const rtWF = rawReturnWF.startsWith("/console/") ? rawReturnWF : null;
      const backWF = (qs: string) => NextResponse.redirect(new URL(`${rtWF ?? (reg ? `/console/registrations/${reg.id}` : "/console/registrations")}${qs}`, origin), 303);
      if (!reg) return backWF("?err=fields");
      const waive = op === "waiveFee";
      const person = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true } });
      if (!person) return backWF("?err=fields");
      // Flip the waiver flag on every registration this person has in the season.
      await prisma.registration.updateMany({ where: { personId, seasonId: reg.seasonId }, data: { feeWaived: waive } });
      if (waive) {
        // Every not-yet-fully-paid fee covering this player — an outstanding
        // request, a failed charge, OR an active payment plan (subscription).
        const covering = await prisma.payment.findMany({
          where: {
            seasonId: reg.seasonId,
            category: "PLAYER_FEE",
            status: { in: ["REQUESTED", "PENDING", "FAILED"] },
            OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
          },
        });
        for (const p of covering) {
          const covers = Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as unknown[]).map(String).filter(Boolean) : [];
          // Only settle an invoice this player is the sole payer/coveree on — a
          // shared family invoice still owes for the others and must stand.
          const soleCover = covers.length ? covers.every((c) => c === personId) : p.partyId === personId;
          if (!soleCover) continue;
          // If they were on a Stripe payment plan, cancel the subscription so no
          // further installments are charged — waiving must actually stop the money.
          if (p.stripeSubscriptionId && isStripeConfigured()) {
            try { await stripe().subscriptions.cancel(p.stripeSubscriptionId); } catch (e) { console.error("waive: sub cancel failed", e); }
          }
          await prisma.payment.update({
            where: { id: p.id },
            data: {
              status: "PAID",
              method: "MANUAL",
              paidAt: new Date(),
              amountCents: 0,
              manualNote: "Waived — no charge ($0)",
              ...(p.installmentPlan ? { installmentsPaid: p.installmentsTotal ?? 3 } : {}),
            },
          });
        }
      }
      await audit({
        actorId: actor.userId,
        entityType: "Registration",
        entityId: reg.id,
        action: waive ? "FEE_WAIVE" : "FEE_UNWAIVE",
        summary: `${waive ? "Waived" : "Un-waived"} season fee (no charge) for ${person.firstName} ${person.lastName}`.trim(),
      });
      return backWF(`?ok=${waive ? "waived" : "unwaived"}`);
    }

    // Split a consolidated family fee (one invoice covering several players) into
    // a separate per-player invoice for each — e.g. a father and son on two
    // different teams. Only a not-yet-paid (REQUESTED) invoice can be split.
    case "splitFee": {
      if (!reg) return back("?err=fields");
      const person = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true } });
      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const season = await prisma.season.findUnique({ where: { id: reg.seasonId }, select: { name: true } });
      const res = await splitFamilyFee({ playerId: personId, seasonId: reg.seasonId, feeCents, seasonName: season?.name ?? "Season" });
      if (!res.ok) {
        const code = res.reason === "inflight" ? "splitpaid" : res.reason === "single" ? "splitsingle" : "fields";
        return back(`?err=${code}`);
      }
      await audit({
        actorId: actor.userId,
        entityType: "Registration",
        entityId: reg.id,
        action: "payment.split",
        summary: `Split family fee into ${res.players} per-player invoices${person ? ` (via ${person.firstName} ${person.lastName})` : ""}`,
      });
      return back("?ok=split");
    }

    // Email the player (or a minor's parent/guardian) a tokenized, no-login link
    // to complete the participation waiver. Their record updates on signing.
    // Convert a trial to a paying registration: clear the trial flag and send the
    // combined welcome + apparel + season-fee request (the fee is auto-prorated
    // to the weeks remaining).
    case "convertTrial": {
      if (!actor) return back("?err=auth");
      if (!can(actor.role, "managePlayers")) return back("?err=auth");
      if (!reg) return back("?err=notfound");
      await prisma.registration.update({ where: { id: reg.id }, data: { trial: false } });
      await ensureSeasonFeePayable(personId, reg.seasonId).catch(() => {});
      await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "registration.convertTrial", summary: "Converted trial to paying (fee requested)" });
      return back(`/${reg.id}?ok=trialconverted`);
    }

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
      // If this person has ANOTHER registration in the same season (a duplicate
      // signup — e.g. Dara registered twice), their team placement belongs to the
      // other registration, so DON'T pull them off their team when deleting this
      // duplicate. Only remove team memberships when this is their last one.
      const otherRegs = await prisma.registration.count({
        where: { personId, seasonId: reg.seasonId, id: { not: reg.id } },
      });
      const pulled = otherRegs === 0;
      if (pulled) {
        const seasonTeams = await seasonTeamIds(reg.seasonId);
        if (seasonTeams.length) {
          await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: seasonTeams } } });
        }
      }
      await prisma.registration.delete({ where: { id: reg.id } });
      await audit({
        actorId: actor.userId,
        entityType: "Registration",
        entityId: reg.id,
        action: "DELETE",
        summary: `Removed registration for ${personId}; ${pulled ? "pulled from season teams" : "kept team placement (has another registration)"}`,
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
          ...(g("emergencyRelation") ? { emergencyRelation: g("emergencyRelation") } : {}),
          ...(g("emergencyName2") ? { emergencyName2: g("emergencyName2") } : {}),
          ...(g("emergencyPhone2") ? { emergencyPhone2: g("emergencyPhone2") } : {}),
          ...(g("emergencyRelation2") ? { emergencyRelation2: g("emergencyRelation2") } : {}),
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
      const person = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true } });
      if (!person) return back("?err=fields");
      const r = await sendTeamLaunch({ personId, seasonId: reg.seasonId, senderId: actor.userId });
      if (!r.ok) return back("?err=fields");
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
      // Match the fee that COVERS this player — a minor's fee is billed to their
      // guardian (partyId = the parent), so a partyId-only lookup would miss it
      // and wrongly report "no outstanding fee".
      const pay = await prisma.payment.findFirst({
        where: {
          seasonId: reg.seasonId,
          category: "PLAYER_FEE",
          status: { in: ["REQUESTED", "PENDING"] },
          OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (!person || !pay) return NextResponse.redirect(new URL(`/console/registrations/${reg.id}?err=nopayment`, origin), 303);
      // Greet the paying adult (the invoice's party), who may be the guardian.
      const payer = pay.partyId ? await prisma.person.findUnique({ where: { id: pay.partyId }, select: { firstName: true } }) : null;
      const email = paymentRequestEmail({ name: payer?.firstName ?? person.firstName, amountCents: pay.amountCents, description: pay.description ?? "Season fee", paymentId: pay.id });
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
      // Match the fee covering this player — a minor's is billed to the guardian.
      const pay = await prisma.payment.findFirst({
        where: {
          seasonId: reg.seasonId,
          category: "PLAYER_FEE",
          status: "PAID",
          OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
        },
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
            direction: "OUT", partyId: pay.partyId ?? personId, amountCents: pay.amountCents, method: "STRIPE",
            status: "PAID", category: "REFUND", seasonId: reg.seasonId, paidAt: new Date(),
            description: `Refund — ${pay.description ?? "season fee"} [simulated]`,
          },
        });
      }
      await audit({ actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "REFUNDED", summary: "Refund issued" });
      return back("?ok=refund");
    }

    // Refund a player who's no longer participating AND stop any active payment
    // plan: refund every charge collected (one-time OR each paid subscription
    // installment), cancel the Stripe subscription so nothing bills again, and
    // mark the fee refunded. One button for "they're done, give the money back".
    case "refundStopPlan": {
      if (!reg) return back("?err=fields");
      // The fee covering this player — a settled one-time fee OR an active plan
      // (PENDING with installments). A minor's fee is billed to the guardian.
      const pay = await prisma.payment.findFirst({
        where: {
          seasonId: reg.seasonId,
          category: "PLAYER_FEE",
          status: { in: ["PAID", "PENDING"] },
          OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
        },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      });
      if (!pay) return back("?err=norefund");
      const original = { id: pay.id, partyId: pay.partyId, seasonId: pay.seasonId, amountCents: pay.amountCents, status: pay.status, description: pay.description };

      let refundedCents = 0;
      if (isStripeConfigured() && (pay.stripeSubscriptionId || pay.stripePaymentIntentId)) {
        try {
          if (pay.stripeSubscriptionId) {
            // Stop future installments first, then refund every paid invoice.
            try { await stripe().subscriptions.cancel(pay.stripeSubscriptionId); } catch (e) { console.error("refundStopPlan: sub cancel failed", e); }
            const invoices = await stripe().invoices.list({ subscription: pay.stripeSubscriptionId, limit: 100 });
            for (const inv of invoices.data) {
              const chargeRef = (inv as unknown as { charge?: string | { id?: string } | null }).charge;
              const chargeId = typeof chargeRef === "string" ? chargeRef : chargeRef?.id ?? null;
              if (!chargeId) continue;
              const charge = await stripe().charges.retrieve(chargeId);
              if ((charge.amount_refunded ?? 0) < charge.amount) {
                await stripe().refunds.create({ charge: chargeId }).catch((e) => console.error("refund create failed", e));
              }
              const fresh = await stripe().charges.retrieve(chargeId);
              const res = await syncRefundsForCharge(original, fresh.id, fresh.amount, fresh.amount_refunded);
              refundedCents += res.createdCents;
            }
          } else if (pay.stripePaymentIntentId) {
            const refund = await stripe().refunds.create({ payment_intent: pay.stripePaymentIntentId });
            const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? null;
            if (chargeId) {
              const charge = await stripe().charges.retrieve(chargeId);
              const res = await syncRefundsForCharge(original, charge.id, charge.amount, charge.amount_refunded);
              refundedCents += res.createdCents;
            }
          }
        } catch {
          return back(`/${reg.id}?err=refundfail`);
        }
      } else {
        // No Stripe linkage / not configured — book a simulated refund so the
        // ledger balances, and (below) mark the fee refunded.
        await prisma.payment.create({
          data: {
            direction: "OUT", partyId: pay.partyId ?? personId, amountCents: pay.amountCents, method: "STRIPE",
            status: "PAID", category: "REFUND", seasonId: reg.seasonId, paidAt: new Date(),
            description: `Refund — ${pay.description ?? "season fee"} [simulated]`,
          },
        });
        refundedCents = pay.amountCents;
      }

      // The fee is settled as refunded and the plan (if any) is cancelled.
      await prisma.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED" } });
      await audit({
        actorId: actor.userId, entityType: "Payment", entityId: pay.id, action: "REFUNDED",
        summary: `Refund & stop plan — refunded $${(refundedCents / 100).toFixed(2)}${pay.stripeSubscriptionId ? " and cancelled the payment plan" : ""}`,
      });
      return back(`/${reg.id}?ok=refundstop`);
    }

    // Remove a withdrawn player ENTIRELY for the season: refund + cancel any plan
    // (money back), then delete their registration(s), team placement, season-fee
    // + refund + apparel payments, and apparel orders — so they disappear from
    // every list. The bare Person record is kept (it's referenced widely and is
    // harmless with nothing attached), so this never orphans other data.
    case "removePlayerEntirely": {
      if (!reg) return back("?err=fields");
      const seasonId = reg.seasonId;
      // Fees covering this player (a minor's is billed through a guardian).
      const feePays = await prisma.payment.findMany({
        where: {
          seasonId, direction: "IN", category: "PLAYER_FEE",
          OR: [{ partyId: personId }, { coveredPersonIds: { array_contains: personId } }],
        },
      });
      // 1) Return the money: cancel each plan and refund every collected charge.
      if (isStripeConfigured()) {
        for (const pay of feePays) {
          try {
            if (pay.stripeSubscriptionId) {
              try { await stripe().subscriptions.cancel(pay.stripeSubscriptionId); } catch (e) { console.error("removePlayer: sub cancel failed", e); }
              const invoices = await stripe().invoices.list({ subscription: pay.stripeSubscriptionId, limit: 100 });
              for (const inv of invoices.data) {
                const chargeRef = (inv as unknown as { charge?: string | { id?: string } | null }).charge;
                const chargeId = typeof chargeRef === "string" ? chargeRef : chargeRef?.id ?? null;
                if (chargeId) await stripe().refunds.create({ charge: chargeId }).catch((e) => console.error("refund failed", e));
              }
            } else if (pay.stripePaymentIntentId) {
              await stripe().refunds.create({ payment_intent: pay.stripePaymentIntentId }).catch((e) => console.error("refund failed", e));
            }
          } catch (e) { console.error("removePlayer: refund step failed", e); }
        }
      }
      // 2) Delete the rows that make them appear anywhere. Apparel items reference
      //    payments, so clear them first; then payments, placement, registrations.
      const payIds = feePays.map((p) => p.id);
      await prisma.apparelOrderItem.deleteMany({ where: { OR: [{ personId }, ...(payIds.length ? [{ paymentId: { in: payIds } }] : [])] } });
      await prisma.payment.deleteMany({
        where: {
          seasonId,
          OR: [
            { partyId: personId, category: { in: ["PLAYER_FEE", "REFUND", "APPAREL"] } },
            { coveredPersonIds: { array_contains: personId }, category: { in: ["PLAYER_FEE", "APPAREL"] } },
          ],
        },
      });
      const seasonTeams = await seasonTeamIds(seasonId);
      if (seasonTeams.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: seasonTeams } } });
      await prisma.registration.deleteMany({ where: { personId, seasonId } });
      await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "PLAYER_REMOVED", summary: `Removed player entirely for the season — refunded, plan cancelled, registration/payments/apparel deleted` });
      return NextResponse.redirect(new URL(`/console/registrations?ok=playerRemoved`, origin), 303);
    }

    default:
      return back("?err=op");
  }
}
