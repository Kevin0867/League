import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12 } from "@/lib/time";
import { requireAdmin } from "@/lib/rbac";
import { coachEarnings } from "@/lib/domain/coachEarnings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Coach payouts" };

// Drill-down behind the "Payouts (est.)" figure on Payments: who is owed, and
// exactly how each coach's total was built up — every completed practice, the
// role they earned in, and (for a substitute) whose class they covered.
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const coachId = sp.coach;

  const earnings = await coachEarnings(coachId ? { coachId } : undefined);
  const focused = !!coachId && earnings.length > 0 ? earnings[0] : null;
  const grandTotal = earnings.reduce((s, c) => s + c.totalCents, 0);
  const sessionTotal = earnings.reduce((s, c) => s + c.sessionCount, 0);

  const roleLabel = (e: { role: string; coveringForName: string | null }) =>
    e.role === "SUBSTITUTE"
      ? `Sub${e.coveringForName ? ` for ${e.coveringForName}` : ""}`
      : e.role === "ASSISTANT"
      ? "Assistant"
      : e.role === "BACKUP"
      ? "Backup"
      : "Coaching";

  return (
    <div className="space-y-6">
      <Link href="/console/payments" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        ← Back to Payments
      </Link>
      <PageHeader
        title={focused ? `Coach payout — ${focused.name}` : "Coach payouts"}
        subtitle="Earned on completed practices, credited by the clock. Accrues here as classes end — not yet disbursed; a payout run settles it."
      />

      {!focused && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Owed to coaches</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">{formatCents(grandTotal)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Coaches earning</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">{earnings.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completed sessions</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">{sessionTotal}</div>
          </div>
        </div>
      )}

      {earnings.length === 0 ? (
        <div className="card text-center text-slate-400">
          {focused ? "No completed practices yet — nothing earned so far." : "No coach has earned a payout yet — earnings appear as practices are completed."}
        </div>
      ) : (
        <div className="space-y-4">
          {earnings.map((c) => (
            <div key={c.coachId} className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-slate-900">
                  <Link href={`/console/coaches/${c.personId}`} className="hover:text-brand-700 hover:underline">{c.name}</Link>
                </h2>
                <div className="text-right">
                  <div className="text-lg font-extrabold text-slate-900">{formatCents(c.totalCents)}</div>
                  <div className="text-xs text-slate-400">
                    {c.sessionCount} session{c.sessionCount === 1 ? "" : "s"}
                    {c.alaCarteCents > 0 ? ` · ${formatCents(c.alaCarteCents)} lessons/clinics` : ""}
                  </div>
                </div>
              </div>

              {c.sessions.length > 0 ? (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1.5">Date</th>
                      <th>Team</th>
                      <th>Time</th>
                      <th>Role</th>
                      <th className="text-right">Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {c.sessions.map((e) => (
                      <tr key={e.sessionId}>
                        <td className="py-1.5 text-slate-700">{formatDate(e.date)}</td>
                        <td className="text-slate-600">{e.teamName ?? "—"}</td>
                        <td className="text-slate-500">{formatTime12(e.startTime)}–{formatTime12(e.endTime)}</td>
                        <td>
                          <span className={`badge ${e.role === "SUBSTITUTE" ? "bg-amber-100 text-amber-800" : e.role === "ASSISTANT" ? "bg-slate-100 text-slate-600" : "bg-brand-100 text-brand-800"}`}>
                            {roleLabel(e)}
                          </span>
                        </td>
                        <td className="text-right font-medium text-slate-800">{formatCents(e.payCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 font-semibold">
                      <td className="py-1.5" colSpan={4}>Session pay</td>
                      <td className="text-right">{formatCents(c.sessionPayCents)}</td>
                    </tr>
                    {c.alaCarteCents > 0 && (
                      <tr className="text-slate-600">
                        <td colSpan={4}>Private lessons &amp; clinics</td>
                        <td className="text-right">{formatCents(c.alaCarteCents)}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  {c.alaCarteCents > 0 ? "Earnings are from private lessons / clinics only." : "No completed practices yet."}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        A practice counts the moment its class time passes — no check-out needed. Pay follows whoever
        worked the class: when a substitute covered, the sub earns that session and the regular coach
        does not. An assistant earns 50% of the session rate. This is the running estimate; generating a
        payout run on the Payments page locks it into a period for disbursement.
      </p>
    </div>
  );
}
