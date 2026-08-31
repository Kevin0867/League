import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

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
  return back("?heard=1");
}
