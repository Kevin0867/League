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

/** Send an SMS via Twilio's REST API (no SDK needed). */
export async function sendSms(to: string | null | undefined, body: string): Promise<SendResult> {
  if (!to) return { ok: false, simulated: false, error: "no phone number on record" };
  if (!smsConfigured()) {
    console.log(`[SMS simulated] → ${to}: ${body}`);
    return { ok: true, simulated: true };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString("base64");
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
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

/** Send an email via Resend's REST API (no SDK needed). */
export async function sendEmail(
  to: string | null | undefined,
  subject: string,
  body: string,
  html?: string
): Promise<SendResult> {
  if (!to) return { ok: false, simulated: false, error: "no email on record" };
  if (!emailConfigured()) {
    console.log(`[Email simulated] → ${to}: ${subject}`);
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
        from: process.env.EMAIL_FROM ?? "PURE Academy <noreply@purepickleball.com>",
        to,
        subject,
        text: body,
        ...(html ? { html } : {}),
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
