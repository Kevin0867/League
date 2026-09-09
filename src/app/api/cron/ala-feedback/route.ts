import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dispatchMessage } from "@/lib/messaging";
import { signFeedbackToken } from "@/lib/domain/feedback";
import { appUrl } from "@/lib/stripe";

// After a private lesson / clinic is over, automatically text + email the client
// a thank-you and a one-tap review request (pre-attributed to the coach who
// taught). Idempotent via AlaCarteBooking.feedbackSentAt. Protected by CRON_SECRET.
export const dynamic = "force-dynamic";

// Wait this long after the scheduled start before asking (the session is done).
const DONE_BUFFER_MS = 2 * 60 * 60 * 1000; // 2 hours
// Don't reach back further than this (avoids blasting old history on first run).
const LOOKBACK_MS = 4 * 864e5; // 4 days

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const now = new Date();
  const doneBefore = new Date(now.getTime() - DONE_BUFFER_MS);
  const notBefore = new Date(now.getTime() - LOOKBACK_MS);

  const bookings = await prisma.alaCarteBooking.findMany({
    where: {
      status: { in: ["ACCEPTED", "DELIVERED"] },
      feedbackSentAt: null,
      scheduledAt: { lte: doneBefore, gte: notBefore },
    },
    include: {
      offering: { select: { title: true } },
      coach: { select: { id: true, person: { select: { firstName: true, lastName: true } } } },
    },
    take: 200,
  });

  let sent = 0;
  for (const b of bookings) {
    const coachId = b.coach?.id ?? null;
    const coachName = b.coach ? `${b.coach.person.firstName} ${b.coach.person.lastName}` : null;
    const seasonId = null; // à-la-carte bookings aren't season-scoped
    const token = await signFeedbackToken(b.clientId, seasonId, "ALACARTE", coachId);
    const link = `${appUrl()}/feedback/${token}`;
    const what = b.offering?.title ? `your ${b.offering.title}` : "your session";

    const res = await dispatchMessage({
      seasonId,
      audienceType: "SINGLE_PERSON", audienceRef: b.clientId,
      channels: ["EMAIL", "SMS"], triggerType: "ALACARTE_FEEDBACK",
      subject: "Thanks for training with PURE Academy!",
      body: `Thank you for ${what}${coachName ? ` with ${coachName}` : ""}! We'd love a quick review — it helps${coachName ? ` ${coachName}` : " our coaches"} and takes a minute: ${link}`,
      smsBody: `PURE Academy — thanks for ${what}${coachName ? ` with ${coachName}` : ""}! A quick review would mean a lot: ${link}`,
    });
    // Mark sent even if delivery simulated/failed for one channel — we attempted
    // it, and re-sending would nag; failures are visible in message logs.
    await prisma.alaCarteBooking.update({ where: { id: b.id }, data: { feedbackSentAt: now } });
    if (!res.failures) sent++;
  }

  return NextResponse.json({ scanned: bookings.length, sent });
}
