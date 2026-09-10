import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";

// Where pay-page questions/replies land so the team sees them immediately.
const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL ?? "team@purepickleball.com";

// Public "why can't you pay by the deadline?" capture from the pay page. The
// payment id in the URL is the capability token (same model as the pay page
// itself), so no login is needed. We only accept a fixed set of reasons + a
// short optional note, and record it against the payment for staff follow-up.
export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  PAYMENT_PLAN: "Needs a payment plan / more time",
  HARDSHIP: "Financial hardship",
  TEAM_QUESTION: "Question about their team or placement",
  NOT_PLAYING: "Not playing this season",
  OTHER: "Other",
};

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const paymentId = String(fd.get("paymentId") ?? "");
  const reason = String(fd.get("reason") ?? "");
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  const back = (qs: string) => NextResponse.redirect(new URL(`/pay/${paymentId}${qs}`, origin), 303);

  if (!paymentId || !REASONS[reason]) return back("?heard=err");
  const pay = await prisma.payment.findUnique({ where: { id: paymentId }, include: { party: true } });
  if (!pay || pay.direction !== "IN") return back("?heard=err");

  const who = pay.party ? `${pay.party.firstName} ${pay.party.lastName}`.trim() : "A family";
  await audit({
    entityType: "Payment",
    entityId: paymentId,
    action: "PAYER_RESPONSE",
    summary: `${who}: ${REASONS[reason]}${note ? ` — “${note}”` : ""}`,
    metadata: { reason, note, partyId: pay.partyId },
  });

  // Email the team inbox so they see it immediately — the pay page captures these
  // silently otherwise. Includes who, why, their note, and their contact info +
  // a console link for fast follow-up. Never block the payer's redirect on it.
  try {
    const email = pay.party?.email ?? null;
    const phone = pay.party?.phone ?? null;
    const link = `${appUrl()}/console/payments`;
    const lines = [
      `${who} responded on the payment page:`,
      ``,
      `Reason: ${REASONS[reason]}`,
      ...(note ? [`Note: “${note}”`] : []),
      ``,
      ...(email ? [`Email: ${email}`] : []),
      ...(phone ? [`Phone: ${phone}`] : []),
      `Amount: $${(pay.amountCents / 100).toFixed(2)} — ${pay.description ?? pay.category}`,
      ``,
      `Open Payments → “Why families haven’t paid”: ${link}`,
    ];
    await sendEmail(
      TEAM_INBOX,
      `Pay page: ${REASONS[reason]} — ${who}`,
      lines.join("\n"),
    );
  } catch (e) {
    console.error("payer-response team email failed", e);
  }

  return back("?heard=1");
}
