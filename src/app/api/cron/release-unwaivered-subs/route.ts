import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";
import { notifySubAutoReleased, notifySubRemoved } from "@/lib/domain/teamCalendar";

// Auto-release sub spots that were claimed on the public open-spots page but
// never had their participation waiver completed. When someone claims a spot we
// tell them they have 2 hours to sign; if they haven't after 2 hours, their
// SessionSub is deleted — which reopens the spot on the open-spots page for
// someone else — and they're told it was released. Only applies to spots claimed
// online (addedByUserId is null); staff-added subs are left alone. Only upcoming
// practices are released (a past one is moot). Protected by CRON_SECRET.
export const dynamic = "force-dynamic";

const WAIVER_DEADLINE_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - WAIVER_DEADLINE_MS);

  // Online claims older than the deadline — candidates for release.
  const claims = await prisma.sessionSub.findMany({
    where: { addedByUserId: null, createdAt: { lte: cutoff } },
    select: { id: true, sessionId: true, personId: true, teamId: true },
  });
  if (claims.length === 0) return NextResponse.json({ ok: true, released: 0 });

  const sessionIds = [...new Set(claims.map((c) => c.sessionId))];
  const personIds = [...new Set(claims.map((c) => c.personId))];
  const [sessions, people] = await Promise.all([
    prisma.session.findMany({ where: { id: { in: sessionIds } }, select: { id: true, date: true, startTime: true, status: true } }),
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, waiverSignedAt: true, guardianId: true, guardian: { select: { waiverSignedAt: true } } } }),
  ]);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const personById = new Map(people.map((p) => [p.id, p]));

  let released = 0;
  for (const c of claims) {
    const session = sessionById.get(c.sessionId);
    const person = personById.get(c.personId);
    if (!session || !person) continue;
    // A signed waiver keeps the spot. For a minor, the guardian's signature counts.
    const signed = person.guardianId ? !!person.guardian?.waiverSignedAt : !!person.waiverSignedAt;
    if (signed) continue;
    // Only release spots for practices that haven't started yet — a past
    // practice's spot is moot, and we don't want to text about it.
    const startsAt = phoenixWallTimeToUtc(session.date, session.startTime);
    if (session.status === "CANCELLED" || startsAt.getTime() <= now.getTime()) continue;

    const removed = await prisma.sessionSub.deleteMany({ where: { id: c.id, addedByUserId: null } });
    if (removed.count > 0) {
      released++;
      // Tell the sub (auto-released) AND the coach the spot reopened.
      await notifySubAutoReleased(c.sessionId, c.teamId, c.personId).catch(() => {});
      await notifySubRemoved(c.sessionId, c.teamId, c.personId).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, released });
}
