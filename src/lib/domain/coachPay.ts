import "server-only";
import { prisma } from "@/lib/db";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";

// Coach session pay accrues on COMPLETION, by the clock — not by check-in.
//
//  • A session counts once its scheduled END time (Phoenix wall time) has
//    passed. A 4:00–6:00 PM class is payable any time after 6:00 PM; no coach
//    has to "check out". (Attendance still flips status to DELIVERED, but pay no
//    longer depends on it.)
//  • Cancelled / rescheduled sessions don't pay — UNLESS an admin chose to pay
//    the coach anyway at cancel time (SessionCoach.paidIfCancelled=true), the
//    "Pay <coach> for this class?" prompt on cancellation.
//  • Pay follows whoever WORKED the class: only SessionCoach rows with
//    payable=true earn. Assigning a substitute sets the normal coach's row to
//    payable=false for that one session (see the schedule route), so the sub is
//    paid for the session they covered and the normal coach is not.

export function isSessionComplete(
  s: { date: Date; endTime: string; status: string },
  now: Date = new Date(),
): boolean {
  if (s.status === "CANCELLED" || s.status === "RESCHEDULED") return false;
  return phoenixWallTimeToUtc(s.date, s.endTime).getTime() <= now.getTime();
}

/**
 * The payable SessionCoach rows a coach has EARNED as of `now`, optionally
 * bounded to a date window (by session date). A row is earned when its class is
 * complete (end time passed, not cancelled) OR it was explicitly marked
 * paid-if-cancelled when the class was called off. One row per coach-per-session,
 * carrying the role so callers can apply the role rate.
 */
export async function payableCompletedRows(opts?: {
  periodStart?: Date;
  periodEnd?: Date;
  now?: Date;
  coachId?: string;
}): Promise<{ coachId: string; role: string }[]> {
  const now = opts?.now ?? new Date();
  const dateWhere =
    opts?.periodStart || opts?.periodEnd
      ? { date: { ...(opts?.periodStart ? { gte: opts.periodStart } : {}), ...(opts?.periodEnd ? { lt: opts.periodEnd } : {}) } }
      : {};
  const rows = await prisma.sessionCoach.findMany({
    where: {
      payable: true,
      ...(opts?.coachId ? { coachId: opts.coachId } : {}),
      session: { ...dateWhere },
    },
    select: { coachId: true, role: true, paidIfCancelled: true, session: { select: { date: true, endTime: true, status: true } } },
  });
  return rows
    .filter((r) => r.paidIfCancelled || isSessionComplete(r.session, now))
    .map((r) => ({ coachId: r.coachId, role: r.role }));
}

/**
 * A coach's private-lesson / clinic (à la carte) earnings that are EARNED — the
 * booking was accepted or delivered and its scheduled time has passed (the class
 * is over). Cancelled/declined never pay; nothing pays before it happens. Sums
 * the stamped coach split. Optional date window (by scheduledAt) for a payout run.
 */
export async function alaCarteEarnedCents(opts?: {
  coachId?: string;
  now?: Date;
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<number> {
  const now = opts?.now ?? new Date();
  const rows = await prisma.alaCarteBooking.findMany({
    where: {
      ...(opts?.coachId ? { coachId: opts.coachId } : {}),
      status: { in: ["ACCEPTED", "DELIVERED"] },
      scheduledAt: {
        lte: now,
        ...(opts?.periodStart ? { gte: opts.periodStart } : {}),
        ...(opts?.periodEnd ? { lt: opts.periodEnd } : {}),
      },
    },
    select: { coachCents: true },
  });
  return rows.reduce((s, r) => s + r.coachCents, 0);
}
