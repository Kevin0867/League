import "server-only";
import { prisma } from "@/lib/db";

// The set of "current" PayoutRun ids — the most-recent run per distinct period.
// Guards every payout TOTAL against duplicate runs: generating a payout used to
// stack a second DRAFT run for the same period rather than replace it, so summing
// every CoachPayoutLine double-counted a coach's pay (inflating the payouts/1099
// exports and the payments dashboard). generatePayoutRun is now idempotent; this
// keeps totals correct even where historical duplicates still exist in the data.
export async function currentPayoutRunIds(): Promise<Set<string>> {
  const runs = await prisma.payoutRun.findMany({
    select: { id: true, periodStart: true, periodEnd: true },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  const keep = new Set<string>();
  for (const r of runs) {
    const key = `${r.periodStart.getTime()}-${r.periodEnd.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keep.add(r.id);
  }
  return keep;
}
