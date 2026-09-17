import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSessionComplete } from "@/lib/domain/coachPay";

// Runs on a short interval (Vercel Cron, see vercel.json). Closes out practices
// that have ended: any SCHEDULED practice whose class time (Phoenix wall clock)
// has passed is flipped to DELIVERED — no coach has to "check out".
//
// Closing a practice is the single action that:
//   • feeds the coaching-hours totals on the Stats page (hours count DELIVERED
//     sessions × the coaches on them);
//   • recognizes coach session pay. Pay accrues by the clock the moment the
//     class is over (see coachPay.ts): every SessionCoach row with payable=true
//     earns the per-session rate, so the coach who worked the class gets it —
//     and when a substitute covered, the sub's row is the payable one and the
//     regular coach's is not, so the $100 follows whoever actually coached.
//
// Idempotent: once a session is DELIVERED it drops out of the SCHEDULED scan.
// Cancelled / rescheduled practices are never auto-closed. Protected by CRON_SECRET.
export const dynamic = "force-dynamic";

// Don't reach indefinitely far back — a season is ~12 weeks, so a wide window
// still closes every practice from the current (and just-past) season without
// scanning all history.
const LOOKBACK_DAYS = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const now = new Date();
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 864e5);

  const candidates = await prisma.session.findMany({
    where: {
      status: "SCHEDULED",
      type: "PRACTICE",
      date: { gte: from, lte: now },
    },
    select: { id: true, date: true, endTime: true, status: true },
  });

  const dueIds = candidates.filter((s) => isSessionComplete(s, now)).map((s) => s.id);

  let closed = 0;
  if (dueIds.length) {
    const res = await prisma.session.updateMany({
      where: { id: { in: dueIds }, status: "SCHEDULED" },
      data: { status: "DELIVERED" },
    });
    closed = res.count;
  }

  return NextResponse.json({ scanned: candidates.length, closed });
}
