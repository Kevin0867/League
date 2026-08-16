import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/notify";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";
import { signCheckinToken } from "@/lib/domain/sessionCheckin";
import { formatTime12 } from "@/lib/time";

// Runs every few minutes (Vercel Cron, see vercel.json). ~15 minutes before a
// session starts it texts two audiences:
//   • the assigned coach(es) — a direct link to that class so they can check
//     players in, add notes, and message the team;
//   • each player (and their guardian) who has opted into SMS — the time and
//     location plus a one-tap self-check-in link for when they arrive.
// Idempotent via Session.checkinReminderSentAt. Protected by CRON_SECRET.
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
      teams: {
        include: {
          team: {
            select: {
              name: true,
              members: {
                select: {
                  person: {
                    select: {
                      id: true,
                      firstName: true,
                      phone: true,
                      smsConsentAt: true,
                      guardian: { select: { firstName: true, phone: true, smsConsentAt: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
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

  let texted = 0; // coach texts
  let players = 0; // player/parent texts
  let reminded = 0;
  for (const s of candidates) {
    const startUtc = phoenixWallTimeToUtc(s.date, s.startTime);
    const minsUntil = (startUtc.getTime() - now.getTime()) / 60000;
    if (minsUntil > LEAD_MINUTES || minsUntil < -GRACE_MINUTES) continue;

    const teamNames = s.teams.map((t) => t.team.name).join(", ") || "your class";
    const when = formatTime12(s.startTime);
    const where = s.facility ? ` · ${s.facility.name}` : "";

    // Coach: reminder + one link to run the class (check in, notes, team message).
    const coachLink = `${origin}/console/schedule/${s.id}`;
    const coachBody = `PURE Academy — ${teamNames} at ${when}${where}. Open your class to check players in, add notes, and message the team: ${coachLink}`;
    for (const sc of s.coaches) {
      const phone = phoneOf.get(sc.coachId);
      if (!phone) continue;
      const res = await sendSms(phone, coachBody);
      if (res.ok) texted++;
    }

    // Players + guardians who opted into SMS: time, place, and a self-check-in
    // link scoped to that player. Dedupe by phone so a parent coaching their own
    // kid, or two players sharing a number, aren't double-texted.
    const roster = s.teams.flatMap((st) => st.team.members.map((m) => m.person));
    const sentTo = new Set<string>();
    for (const p of roster) {
      const token = await signCheckinToken(s.id, p.id);
      const link = `${origin}/checkin/${token}`;
      // Recipients: the player themselves (if they carry consent) and their
      // guardian (if the guardian carries consent). Same check-in link.
      const recips: { phone: string; name: string }[] = [];
      if (p.phone && p.smsConsentAt) recips.push({ phone: p.phone, name: p.firstName });
      if (p.guardian?.phone && p.guardian.smsConsentAt) recips.push({ phone: p.guardian.phone, name: p.firstName });
      for (const r of recips) {
        if (sentTo.has(r.phone)) continue;
        sentTo.add(r.phone);
        const body = `PURE Academy — ${r.name}'s ${teamNames} session starts at ${when}${where}. Tap to check in when you arrive: ${link}`;
        const res = await sendSms(r.phone, body);
        if (res.ok) players++;
      }
    }

    await prisma.session.update({ where: { id: s.id }, data: { checkinReminderSentAt: now } });
    reminded++;
  }

  return NextResponse.json({ scanned: candidates.length, reminded, texted, players });
}
