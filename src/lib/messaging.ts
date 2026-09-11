import "server-only";
import { prisma } from "./db";
import { sendSms, sendEmail, type EmailAttachment } from "./notify";
import { resolveAudience, type AudienceType } from "./domain/audience";
import { recordSmsRoute } from "./domain/smsRouting";

// Central dispatcher (§13). Creates the Message, resolves the audience, writes a
// per-person delivery record for each recipient, and attempts each requested
// channel. Every message is logged per person and per team so "we told them" is
// verifiable, and delivery failure is recorded as an error state — never a
// silent drop.

export type Channel = "IN_APP" | "EMAIL" | "SMS";

// Message trigger types that are internal to STAFF (coaches/admins) and must
// never surface in a family's portal — sub coordination, coach scheduling, the
// lounge board, availability escalation. A coach who is also a parent still
// gets these in the console; they're filtered out of the portal inbox only.
export const STAFF_ONLY_TRIGGERS = [
  "SUB_REQUEST", "SUB_OFFER", "SUB_APPROVED", "SUB_DECLINED",
  "COACH_ASSIGNED_SESSION", "COACH_SCHEDULE_CHANGE", "COACH_SCHEDULE_SET",
  "COACH_BOARD", "COACH_LESSON_ASSIGNED", "AVAILABILITY_ESCALATION",
] as const;

// Run `fn` over `items` with at most `limit` in flight at once, preserving input
// order in the results. Lets independent provider calls overlap without firing
// hundreds at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export type DispatchInput = {
  senderId?: string | null;
  seasonId?: string | null;
  audienceType: AudienceType;
  audienceRef?: string | null;
  channels: Channel[];
  subject?: string;
  body: string;
  /** Optional branded HTML for the EMAIL channel; `body` remains the text fallback. */
  html?: string;
  /** Optional short text for the SMS channel. When omitted, SMS falls back to
   *  the subject + body (fine for already-short messages; set this when `body`
   *  is a long email). */
  smsBody?: string;
  /** Optional email attachments (e.g. an .ics calendar invite). */
  attachments?: EmailAttachment[];
  /** Optional in-app photo/video attachment (Vercel Blob URL + IMAGE|VIDEO) —
   *  e.g. a coach sharing a practice clip with the team. */
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  triggerType?: string | null;
  /** Explicit, hand-picked email recipients (from a "Send to" checklist). When
   *  set, the EMAIL channel goes to exactly these addresses and guardian
   *  expansion is suppressed, so the sender controls precisely who receives it. */
  toEmails?: string[];
};

export type DispatchResult = {
  messageId: string;
  recipients: number;
  failures: number;
  /** Recipients whose send was SIMULATED (provider unconfigured) — nothing
   *  actually left the building, even though it didn't error. */
  simulated: number;
  /** Human-readable reasons for each channel failure, for surfacing to admins. */
  failureReasons: string[];
  /** Recipients for whom a REQUESTED channel had no address on file — SMS asked
   *  for but no phone, or email asked for but no address. Not a delivery failure
   *  (nothing was attempted), but the admin should know the channel was skipped. */
  noPhone: number;
  noEmail: number;
};

export async function dispatchMessage(input: DispatchInput): Promise<DispatchResult> {
  const channels = input.channels.length ? input.channels : ["IN_APP"];
  const pickedEmails = (input.toEmails ?? []).map((e) => e.trim()).filter(Boolean);
  const hasPicked = pickedEmails.length > 0;
  const recipients = await resolveAudience(
    input.audienceType,
    input.audienceRef ?? null,
    input.seasonId ?? null,
    // Hand-picked recipients: don't expand to the guardian (avoids duplicate sends).
    hasPicked ? false : undefined
  );

  const message = await prisma.message.create({
    data: {
      senderId: input.senderId ?? null,
      seasonId: input.seasonId ?? null,
      audienceType: input.audienceType,
      audienceRef: input.audienceRef ?? null,
      channels: channels.join(","),
      triggerType: input.triggerType ?? null,
      subject: input.subject ?? null,
      body: input.body,
      html: input.html ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      attachmentType: input.attachmentType ?? null,
    },
  });

  const subject = input.subject ?? "PURE Academy";
  // Resolve the sender's Person id so replies to this broadcast's texts route
  // back to them (a coach/admin), not to the shared team inbox.
  const senderPersonId = input.senderId
    ? (await prisma.user.findUnique({ where: { id: input.senderId }, select: { personId: true } }))?.personId ?? null
    : null;
  let failures = 0;
  let simulated = 0;
  const allFailureReasons: string[] = [];

  // Guardian expansion can put the same address on two recipients (a minor whose
  // contact is the parent, plus the parent themselves). Track what we've already
  // sent so one physical email/text address is only messaged once per send; the
  // second recipient still gets a logged row, marked SKIPPED.
  const sentEmails = new Set<string>();
  const sentPhones = new Set<string>();
  let noPhone = 0;
  let noEmail = 0;

  // Phase 1 — plan every recipient's sends up front. This is pure bookkeeping
  // (no network), and it OWNS the once-per-address dedup, so it must stay
  // sequential: whoever is planned first "wins" the address; later duplicates
  // are marked SKIPPED. Deciding this here lets the slow provider calls in
  // phase 2 run in parallel without racing on the dedup sets or double-sending.
  const inAppStatus = channels.includes("IN_APP") ? "DELIVERED" : "QUEUED";
  // The STOP opt-out notice is appended centrally in sendSms (on every text),
  // so we don't add one here.
  const smsText = input.smsBody ?? `${subject}\n${input.body}`;
  type Plan = { r: (typeof recipients)[number]; freshEmails: string[]; emailSkipped: boolean; smsNum: string | null; smsSkipped: boolean };
  const plans: Plan[] = recipients.map((r) => {
    let freshEmails: string[] = [];
    let emailSkipped = false;
    if (channels.includes("EMAIL")) {
      const candidates = (hasPicked ? pickedEmails : r.emails.length ? r.emails : r.email ? [r.email] : [])
        .map((e) => (e ?? "").trim())
        .filter(Boolean);
      freshEmails = candidates.filter((e) => {
        const k = e.toLowerCase();
        if (sentEmails.has(k)) return false;
        sentEmails.add(k);
        return true;
      });
      if (!freshEmails.length) {
        if (candidates.length) emailSkipped = true; // reached via another recipient
        else noEmail++; // email requested but no address on file
      }
    }
    let smsNum: string | null = null;
    let smsSkipped = false;
    if (channels.includes("SMS")) {
      const num = (r.phone ?? "").trim();
      const k = num.toLowerCase();
      if (num && !sentPhones.has(k)) {
        sentPhones.add(k);
        smsNum = num;
      } else if (num) {
        smsSkipped = true;
      } else {
        noPhone++;
      }
    }
    return { r, freshEmails, emailSkipped, smsNum, smsSkipped };
  });

  // Phase 2 — do the actual provider calls and per-recipient log write. These
  // are independent per recipient, so run them with bounded concurrency instead
  // of one-at-a-time: a team blast that took ~a minute sequentially now finishes
  // in a few seconds. The cap keeps us from hammering the SMS/email providers.
  const rows = await mapLimit(plans, 8, async (p) => {
    let emailStatus: string | null = null;
    let smsStatus: string | null = null;
    let wasSimulated = false;
    const failureReasons: string[] = [];

    if (channels.includes("EMAIL")) {
      if (p.freshEmails.length) {
        const res = await sendEmail(p.freshEmails, subject, input.body, input.html, input.attachments);
        emailStatus = res.ok ? (res.simulated ? "SENT" : "DELIVERED") : "FAILED";
        if (!res.ok) failureReasons.push(`email: ${res.error}`);
        if (res.ok && res.simulated) wasSimulated = true;
      } else if (p.emailSkipped) {
        emailStatus = "SKIPPED";
      }
    }
    if (channels.includes("SMS")) {
      if (p.smsNum) {
        const res = await sendSms(p.smsNum, smsText);
        smsStatus = res.ok ? (res.simulated ? "SENT" : "DELIVERED") : "FAILED";
        if (!res.ok) failureReasons.push(`sms: ${res.error}`);
        if (res.ok && res.simulated) wasSimulated = true;
        // Route this recipient's text-back to the sender (coach/admin).
        if (senderPersonId && senderPersonId !== p.r.personId) {
          await recordSmsRoute({ phone: p.smsNum, personId: p.r.personId, senderPersonId, messageId: message.id });
        }
      } else if (p.smsSkipped) {
        smsStatus = "SKIPPED";
      }
    }

    if (failureReasons.length) {
      failures++;
      allFailureReasons.push(...failureReasons);
    } else if (wasSimulated) {
      simulated++;
    }
    return {
      messageId: message.id,
      personId: p.r.personId,
      inAppStatus,
      emailStatus,
      smsStatus,
      failedReason: failureReasons.length ? failureReasons.join("; ") : null,
    };
  });

  if (rows.length) await prisma.messageRecipient.createMany({ data: rows });

  return { messageId: message.id, recipients: recipients.length, failures, simulated, failureReasons: allFailureReasons, noPhone, noEmail };
}
