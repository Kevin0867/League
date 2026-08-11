import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/notify";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";
import { formatTime12 } from "@/lib/time";

// Runs every few minutes (Vercel Cron, see vercel.json). ~15 minutes before a
// session starts, texts the assigned coach(es) a direct link to that class so
// they can check their players in. Idempotent via Session.checkinReminderSentAt.
// Protected by CRON_SECRET when set.
export const dynamic = "force-dynamic";

// Fire when the start is within this many minutes ahead (a 5-min cron catches it
// once inside the window; the sent-marker prevents a repeat).
const LEAD_MINUTES = 16;
// Small grace so a slightly-late run still sends rather than skipping.
const GRACE_MINUTES = 3;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const now = new Date();
  const origin = new URL(req.url).origin;

  // Bound the scan to a couple of days around now; the exact window is computed
  // per session from its Phoenix wall-clock start time.
  const from = new Date(now.getTime() - 2 * 864e5);
  const to = new Date(now.getTime() + 2 * 864e5);

  const candidates = await prisma.session.findMany({
    where: {
      status: { in: ["SCHEDULED", "DELIVERED"] },
      checkinReminderSentAt: null,
      date: { gte: from, lte: to },
      coaches: { some: {} },
    },
    include: {
      facility: { select: { name: true } },
      teams: { include: { team: { select: { name: true } } } },
      coaches: { select: { coachId: true } },
    },
  });

  // SessionCoach has no direct Coach relation — resolve the phone numbers in one
  // query keyed by coach id.
  const coachIds = [...new Set(candidates.flatMap((s) => s.coaches.map((c) => c.coachId)))];
  const coaches = coachIds.length
    ? await prisma.coach.findMany({ where: { id: { in: coachIds } }, select: { id: true, person: { select: { phone: true } } } })
    : [];
  const phoneOf = new Map(coaches.map((c) => [c.id, c.person?.phone ?? null]));

  let texted = 0;
  let reminded = 0;
  for (const s of candidates) {
    const startUtc = phoenixWallTimeToUtc(s.date, s.startTime);
    const minsUntil = (startUtc.getTime() - now.getTime()) / 60000;
    if (minsUntil > LEAD_MINUTES || minsUntil < -GRACE_MINUTES) continue;

    const teamNames = s.teams.map((t) => t.team.name).join(", ") || "your class";
    const link = `${origin}/console/schedule/${s.id}`;
    const body = `PURE Academy: ${teamNames} starts at ${formatTime12(s.startTime)}${s.facility ? ` · ${s.facility.name}` : ""}. Check your players in: ${link}`;

    for (const sc of s.coaches) {
      const phone = phoneOf.get(sc.coachId);
      if (!phone) continue;
      const res = await sendSms(phone, body);
      if (res.ok) texted++;
    }
    await prisma.session.update({ where: { id: s.id }, data: { checkinReminderSentAt: now } });
    reminded++;
  }

  return NextResponse.json({ scanned: candidates.length, reminded, texted });
}
