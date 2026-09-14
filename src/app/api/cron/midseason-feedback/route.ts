import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendFeedbackCampaign } from "@/lib/domain/feedbackCampaign";

// Automated mid-season feedback request. Fires once per season at the end of
// week 6 — the last week of coaching before league play. Runs daily; idempotent
// via Season.midseasonFeedbackSentAt (also set when an admin sends it manually).
export const dynamic = "force-dynamic";

// End of week 6 = six full weeks after the season start.
const WEEK6_DAYS = 6 * 7;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const now = new Date();
  const seasons = await prisma.season.findMany({
    where: { active: true, isTest: false, program: "PURE_ACADEMY", midseasonFeedbackSentAt: null },
    select: { id: true, startDate: true },
  });

  const results: { seasonId: string; sent: number }[] = [];
  for (const s of seasons) {
    const threshold = new Date(s.startDate);
    threshold.setDate(threshold.getDate() + WEEK6_DAYS);
    if (now < threshold) continue; // not yet end of week 6

    // Claim the send first (stamp before sending) so a slow run can't double-fire.
    await prisma.season.update({ where: { id: s.id }, data: { midseasonFeedbackSentAt: now } });

    const regs = await prisma.registration.findMany({
      where: { seasonId: s.id, status: { notIn: ["WITHDRAWN", "DUPLICATE", "MERGED"] } },
      select: { personId: true },
    });
    const personIds = [...new Set(regs.map((r) => r.personId))];
    const sent = await sendFeedbackCampaign({ senderId: null, seasonId: s.id, phase: "MIDSEASON", personIds });
    results.push({ seasonId: s.id, sent });
  }

  return NextResponse.json({ ran: results.length, results });
}
