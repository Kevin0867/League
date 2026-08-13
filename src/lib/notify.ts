import "server-only";

// Delivery providers. Everything is sent in-platform and mirrored to email, with
// SMS for time-critical items (§13). Providers are optional: when unconfigured,
// sends are SIMULATED and clearly marked, so the flow works end-to-end in dev.
// Cancellation and forfeit messages must treat delivery failure as an error
// state, not a silent drop — so every send returns an explicit result.

export type SendResult = { ok: boolean; simulated: boolean; error?: string; id?: string };

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// Every SMS leads with the business name so recipients recognize the sender and
// carriers treat it as identified A2P traffic — unbranded texts are the single
// biggest trigger for carrier spam filtering. Skip when the body already starts
// with the brand (e.g. dispatchMessage leads with a "PURE Academy" subject line)
// so we never produce "PURE Academy: PURE Academy …".
const SMS_BRAND = "PURE Academy";
function brandSms(body: string): string {
  return new RegExp(`^\\s*${SMS_BRAND}`, "i").test(body) ? body : `${SMS_BRAND}: ${body}`;
}

/** Send an SMS via Twilio's REST API (no SDK needed). */
export async function sendSms(to: string | null | undefined, rawBody: string): Promise<SendResult> {
  if (!to) return { ok: false, simulated: false, error: "no phone number on record" };
  const body = brandSms(rawBody);
  if (!smsConfigured()) {
    console.log(`[SMS simulated] → ${to}: ${body}`);
    return { ok: true, simulated: true };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString("base64");
  const from = process.env.TWILIO_FROM!;
  // TWILIO_FROM may be a Messaging Service SID (starts "MG" — recommended for
  // A2P 10DLC / toll-free so traffic is tied to the approved campaign and Twilio
  // picks the sender from the pool) or a single sender number in E.164 (+1…).
  // Use whichever Twilio parameter matches.
  const params: Record<string, string> = { To: to, Body: body };
  if (from.startsWith("MG")) params.MessagingServiceSid = from;
  else params.From = from;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, simulated: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { sid?: string };
    return { ok: true, simulated: false, id: json.sid };
  } catch (e) {
    return { ok: false, simulated: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

/** A file attached to an email (content is base64-encoded). */
export type EmailAttachment = { filename: string; content: string; contentType?: string };

/** Send an email via Resend's REST API (no SDK needed). Accepts a single address
 *  or a list — a person may carry up to three notification addresses (both
 *  parents + the student), and all should receive the same email. */
export async function sendEmail(
  to: string | string[] | null | undefined,
  subject: string,
  body: string,
  html?: string,
  attachments?: EmailAttachment[]
): Promise<SendResult> {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((t) => (t ?? "").trim())
    .filter(Boolean);
  if (recipients.length === 0) return { ok: false, simulated: false, error: "no email on record" };
  if (!emailConfigured()) {
    console.log(`[Email simulated] → ${recipients.join(", ")}: ${subject}${attachments?.length ? ` (+${attachments.length} attachment)` : ""}`);
    return { ok: true, simulated: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "PURE Academy <team@purepickleball.com>",
        to: recipients,
        // Replies go to the team inbox by default (override with EMAIL_REPLY_TO).
        reply_to: process.env.EMAIL_REPLY_TO ?? "team@purepickleball.com",
        // Optionally copy every outbound email to a shared inbox for a record.
        ...(process.env.EMAIL_BCC ? { bcc: process.env.EMAIL_BCC } : {}),
        subject,
        text: body,
        ...(html ? { html } : {}),
        ...(attachments?.length
          ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) }
          : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, simulated: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, simulated: false };
  } catch (e) {
    return { ok: false, simulated: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
