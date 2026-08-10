import "server-only";
import { prisma } from "./db";
import { sendSms, sendEmail } from "./notify";
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
  triggerType?: string | null;
};

export type DispatchResult = {
  messageId: string;
  recipients: number;
  failures: number;
};

export async function dispatchMessage(input: DispatchInput): Promise<DispatchResult> {
  const channels = input.channels.length ? input.channels : ["IN_APP"];
  const recipients = await resolveAudience(
    input.audienceType,
    input.audienceRef ?? null,
    input.seasonId ?? null
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

  for (const r of recipients) {
    // In-app is always delivered — it lives in our own database.
    const inAppStatus = channels.includes("IN_APP") ? "DELIVERED" : "QUEUED";

    let emailStatus: string | null = null;
    let smsStatus: string | null = null;
    const failureReasons: string[] = [];

    if (channels.includes("EMAIL")) {
      const res = await sendEmail(r.email, subject, input.body, input.html);
      emailStatus = res.ok ? (res.simulated ? "SENT" : "DELIVERED") : "FAILED";
      if (!res.ok) failureReasons.push(`email: ${res.error}`);
    }
    if (channels.includes("SMS")) {
      const res = await sendSms(r.phone, `${subject}\n${input.body}`);
      smsStatus = res.ok ? (res.simulated ? "SENT" : "DELIVERED") : "FAILED";
      if (!res.ok) failureReasons.push(`sms: ${res.error}`);
    }

    if (failureReasons.length) failures++;

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

  return { messageId: message.id, recipients: recipients.length, failures };
}
