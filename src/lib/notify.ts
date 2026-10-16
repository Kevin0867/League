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

// Carrier/A2P compliance: every outbound text must carry an opt-out notice.
// Centralized here so it's guaranteed on EVERY SMS regardless of the caller.
export const SMS_OPT_OUT = 'To opt-out of text messages from PURE Pickleball & Padel, reply with "STOP".';
function withOptOut(body: string): string {
  // Idempotent — don't double up if a caller already included STOP opt-out text.
  return /\bstop\b/i.test(body) && /opt[\s-]?out|unsubscribe|reply/i.test(body)
    ? body
    : `${body}\n\n${SMS_OPT_OUT}`;
}

// Twilio rejects a concatenated SMS body over 1600 characters (error 21617).
// This caps the caller's body BEFORE we add the brand prefix (~15 chars) and the
// opt-out notice (~95 chars), so the final message always lands under 1600 and a
// text never fails just for being long. Set as high as that budget allows so
// full announcements go out intact — this is the final safety net, not the
// primary trim (callers trim to SMS_FULL_CAP first).
const SMS_BODY_CAP = 1450;

/** Send an SMS via Twilio's REST API (no SDK needed). */
export async function sendSms(to: string | null | undefined, rawBody: string): Promise<SendResult> {
  if (!to) return { ok: false, simulated: false, error: "no phone number on record" };
  const capped = rawBody.length > SMS_BODY_CAP ? `${rawBody.slice(0, SMS_BODY_CAP).trimEnd()}…` : rawBody;
  const body = withOptOut(brandSms(capped));
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

// --- Resend rate limiting ------------------------------------------------
// Resend enforces a per-second request cap on the account (commonly 2 on the
// free tier, 10 on paid). A club-wide blast sends one email per recipient; fired
// at full concurrency it instantly exceeds that cap, and Resend rejects the
// overflow with HTTP 429 ("you can only make N requests per second"). That
// surfaced to admins as "can only send 10 at a time" and silently dropped the
// throttled recipients. We fix it two ways so a blast of ANY size reaches
// everyone: (1) pace outbound Resend calls to stay under the limit, and (2)
// retry a 429 (honoring Retry-After) or transient 5xx instead of failing.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Keep request starts at least MIN_GAP_MS apart → a steady ceiling of about
// RESEND_MAX_RPS requests/second no matter how many sends are in flight. Tune
// RESEND_MAX_RPS to the account's Resend plan (default stays under the common
// 10/s paid tier). Admissions are serialized through a promise chain so the
// spacing holds even when many sends race from the same blast.
const RESEND_MAX_RPS = Math.max(1, Number(process.env.RESEND_MAX_RPS ?? 8) || 8);
const MIN_GAP_MS = Math.ceil(1000 / RESEND_MAX_RPS);
let resendLastStart = 0;
let resendGate: Promise<void> = Promise.resolve();
function resendAdmit(): Promise<void> {
  resendGate = resendGate.then(async () => {
    const wait = resendLastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    resendLastStart = Date.now();
  });
  return resendGate;
}

// POST to Resend with pacing + retry on a rate-limit (429) or transient 5xx, so
// a large blast never loses recipients to throttling — it just paces itself.
async function resendPost(payload: Record<string, unknown>): Promise<SendResult> {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; ; attempt++) {
    await resendAdmit();
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS) return { ok: false, simulated: false, error: e instanceof Error ? e.message : "send failed" };
      await sleep(Math.min(8000, 250 * 2 ** (attempt - 1)));
      continue;
    }
    if (res.ok) return { ok: true, simulated: false };
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      const text = await res.text().catch(() => "");
      return { ok: false, simulated: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
    }
    // Respect Retry-After (seconds) when Resend sends it, else back off.
    const ra = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(8000, 250 * 2 ** (attempt - 1));
    await sleep(backoff);
  }
}

/** Send an email via Resend's REST API (no SDK needed). Accepts a single address
 *  or a list — a person may carry up to three notification addresses (both
 *  parents + the student), and all should receive the same email. */
export async function sendEmail(
  to: string | string[] | null | undefined,
  subject: string,
  body: string,
  html?: string,
  attachments?: EmailAttachment[],
  /** `skipBcc` suppresses the org-wide EMAIL_BCC copy — used for confidential
   *  mail (e.g. an incident report) that must reach ONLY its named recipient.
   *  `replyTo` overrides the default team Reply-To so a reply reaches a specific
   *  person (e.g. the coach who sent a message) instead of the shared inbox. */
  opts?: { skipBcc?: boolean; replyTo?: string | string[] | null }
): Promise<SendResult> {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((t) => (t ?? "").trim())
    .filter(Boolean);
  if (recipients.length === 0) return { ok: false, simulated: false, error: "no email on record" };
  if (!emailConfigured()) {
    console.log(`[Email simulated] → ${recipients.join(", ")}: ${subject}${attachments?.length ? ` (+${attachments.length} attachment)` : ""}`);
    return { ok: true, simulated: true };
  }
  const payload: Record<string, unknown> = {
    from: process.env.EMAIL_FROM ?? "PURE Academy <team@purepickleball.com>",
    to: recipients,
    // Replies go to the message sender when the caller names one (so a coach
    // sees email replies) — and can include the team inbox so admins see the
    // reply too. Falls back to the team inbox (override with EMAIL_REPLY_TO).
    reply_to: (() => {
      const rt = opts?.replyTo;
      const list = (Array.isArray(rt) ? rt : rt ? [rt] : []).map((e) => (e ?? "").trim()).filter(Boolean);
      if (list.length > 1) return list;
      if (list.length === 1) return list[0];
      return process.env.EMAIL_REPLY_TO || "team@purepickleball.com";
    })(),
    // Optionally copy every outbound email to a shared inbox for a record —
    // unless the caller opts out (confidential mail must go only to `to`).
    ...(process.env.EMAIL_BCC && !opts?.skipBcc ? { bcc: process.env.EMAIL_BCC } : {}),
    subject,
    text: body,
    ...(html ? { html } : {}),
    ...(attachments?.length
      ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) }
      : {}),
  };
  // Paced + retried so a club-wide blast stays under Resend's per-second cap and
  // never drops a recipient to a 429.
  return resendPost(payload);
}
