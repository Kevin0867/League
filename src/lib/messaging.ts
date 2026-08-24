import "server-only";
import { prisma } from "./db";
import { sendSms, sendEmail, type EmailAttachment } from "./notify";
import { resolveAudience, type AudienceType } from "./domain/audience";

// Central dispatcher (§13). Creates the Message, resolves the audience, writes a
// per-person delivery record for each recipient, and attempts each requested
// channel. Every message is logged per person and per team so "we told them" is
// verifiable, and delivery failure is recorded as an error state — never a
// silent drop.

export type Channel = "IN_APP" | "EMAIL" | "SMS";

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
    },
  });

  const subject = input.subject ?? "PURE Academy";
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

  for (const r of recipients) {
    // In-app is always delivered — it lives in our own database.
    const inAppStatus = channels.includes("IN_APP") ? "DELIVERED" : "QUEUED";

    let emailStatus: string | null = null;
    let smsStatus: string | null = null;
    let wasSimulated = false;
    const failureReasons: string[] = [];

    if (channels.includes("EMAIL")) {
      // Hand-picked recipients win; otherwise deliver to every address on file
      // for this person (both parents + the student).
      const candidates = (hasPicked ? pickedEmails : r.emails.length ? r.emails : r.email ? [r.email] : [])
        .map((e) => (e ?? "").trim())
        .filter(Boolean);
      // Drop any address already sent to earlier in this dispatch.
      const fresh = candidates.filter((e) => {
        const k = e.toLowerCase();
        if (sentEmails.has(k)) return false;
        sentEmails.add(k);
        return true;
      });
      if (fresh.length) {
        const res = await sendEmail(fresh, subject, input.body, input.html, input.attachments);
        emailStatus = res.ok ? (res.simulated ? "SENT" : "DELIVERED") : "FAILED";
        if (!res.ok) failureReasons.push(`email: ${res.error}`);
        if (res.ok && res.simulated) wasSimulated = true;
      } else if (candidates.length) {
        // Every address was already reached via another recipient (e.g. the parent).
        emailStatus = "SKIPPED";
      } else {
        // Email requested but this recipient has no address on file.
        noEmail++;
      }
    }
    if (channels.includes("SMS")) {
      // Manual broadcasts (no triggerType — the Messaging composer) carry opt-out
      // language, as A2P 10DLC best practice / TCPA expects. Transactional texts
      // (assignment, payment, reminders — each has a triggerType) rely on Twilio's
      // built-in STOP handling and stay concise.
      const optOut = input.triggerType ? "" : "\nReply STOP to opt out.";
      const smsText = input.smsBody ?? `${subject}\n${input.body}`;
      const num = (r.phone ?? "").trim();
      const k = num.toLowerCase();
      if (num && !sentPhones.has(k)) {
        sentPhones.add(k);
        const res = await sendSms(r.phone, `${smsText}${optOut}`);
        smsStatus = res.ok ? (res.simulated ? "SENT" : "DELIVERED") : "FAILED";
        if (!res.ok) failureReasons.push(`sms: ${res.error}`);
        if (res.ok && res.simulated) wasSimulated = true;
      } else if (num) {
        smsStatus = "SKIPPED";
      } else {
        // SMS requested but this recipient has no phone number on file.
        noPhone++;
      }
    }

    if (failureReasons.length) {
      failures++;
      allFailureReasons.push(...failureReasons);
    } else if (wasSimulated) {
      simulated++;
    }

    await prisma.messageRecipient.create({
      data: {
        messageId: message.id,
        personId: r.personId,
        inAppStatus,
        emailStatus,
        smsStatus,
        failedReason: failureReasons.length ? failureReasons.join("; ") : null,
      },
    });
  }

  return { messageId: message.id, recipients: recipients.length, failures, simulated, failureReasons: allFailureReasons, noPhone, noEmail };
}
