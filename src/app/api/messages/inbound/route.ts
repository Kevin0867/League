import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/stripe";
import { sendEmail } from "@/lib/notify";
import { appendMessage, findOrCreateConversation } from "@/lib/domain/dm";
import { lookupInboundRoute, findPersonByPhone } from "@/lib/domain/smsRouting";

// Twilio inbound-SMS webhook. When someone replies to a text we sent, the reply
// arrives here. We route it back to whoever last texted them (a coach/admin) so
// the reply lands in that person's portal inbox and texts them immediately —
// instead of being lost to the shared team inbox. Configure this URL as the
// Messaging webhook on the Twilio number / Messaging Service:
//   https://<host>/api/messages/inbound   (HTTP POST)
export const dynamic = "force-dynamic";

const TEAM_INBOX = "team@purepickleball.com";

// Empty TwiML — we send our own notifications, so Twilio shouldn't auto-reply.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });

/** Does the X-Twilio-Signature verify against ANY of the candidate URLs?
 *  Twilio signs against the exact URL it called; behind proxies the app can see
 *  a different host than the public one, so we try every plausible URL (the
 *  configured one plus the request's own reconstructed URL) and accept if one
 *  matches. Returns true when no auth token is configured (dev/simulated). */
function signatureMatchesAny(urls: string[], params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true; // unconfigured (dev) — allow so the flow is testable
  if (!signature) return false;
  const sortedParams = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], "");
  for (const url of urls) {
    // Twilio: base64(HMAC-SHA1(token, url + concat(sortedKey + value)))
    const expected = crypto.createHmac("sha1", token).update(Buffer.from(url + sortedParams, "utf-8")).digest("base64");
    try {
      if (expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return true;
    } catch {
      // length mismatch — try the next candidate
    }
  }
  return false;
}

export async function POST(req: Request) {
  const fd = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of fd.entries()) params[k] = String(v);

  // Candidate URLs Twilio may have signed against: an explicit override, the
  // configured public app URL, and the request's own URL reconstructed from the
  // forwarded host/proto headers (what a proxy rewrote it to).
  const path = "/api/messages/inbound";
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  const candidates = [
    process.env.TWILIO_INBOUND_URL,
    `${appUrl()}${path}`,
    fwdHost ? `${fwdProto}://${fwdHost}${path}` : null,
    new URL(req.url).toString(),
  ].filter((u): u is string => !!u);

  if (!signatureMatchesAny(candidates, params, req.headers.get("x-twilio-signature"))) {
    console.error("inbound SMS: signature did not match any candidate URL", candidates);
    return new NextResponse("invalid signature", { status: 403 });
  }

  const from = (params.From ?? "").trim();
  const body = (params.Body ?? "").trim();
  if (!from || !body) return twiml();

  // Opt-out / help keywords are handled by Twilio's Advanced Opt-Out for A2P;
  // don't route them as conversation messages.
  const kw = body.toUpperCase().replace(/[^A-Z]/g, "");
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "START", "UNSTOP", "YES", "HELP", "INFO"].includes(kw)) {
    return twiml();
  }

  try {
    const route = await lookupInboundRoute(from);
    // Who sent the text (route them the reply); who is replying (the person).
    let recipientPersonId = route?.recipientPersonId ?? null;
    if (!recipientPersonId) {
      const person = await findPersonByPhone(from);
      recipientPersonId = person?.id ?? null;
    }

    if (route?.senderPersonId && recipientPersonId && route.senderPersonId !== recipientPersonId) {
      // Route the reply into the 1:1 thread with the sender and notify them
      // (staff are always emailed + texted by appendMessage).
      const convId = route.conversationId ?? (await findOrCreateConversation(route.senderPersonId, recipientPersonId));
      await appendMessage(convId, recipientPersonId, body, { email: true, sms: true });
      return twiml();
    }

    // Fallback — we couldn't resolve a sender to route to. Don't lose the reply:
    // forward it to the team inbox with whatever we know about who sent it.
    const who = recipientPersonId
      ? await prisma.person.findUnique({ where: { id: recipientPersonId }, select: { firstName: true, lastName: true } })
      : null;
    const whoName = who ? `${who.firstName} ${who.lastName}`.trim() : "an unknown number";
    await sendEmail(
      TEAM_INBOX,
      `Inbound text reply from ${whoName}`,
      `A text reply came in that we couldn't match to a specific coach/message:\n\nFrom: ${from} (${whoName})\n\n“${body}”\n\nOpen the console inbox to follow up.`,
    );
    return twiml();
  } catch (e) {
    console.error("inbound SMS handling failed", e);
    return twiml(); // never 500 a webhook — Twilio would retry endlessly
  }
}
