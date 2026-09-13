import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { WRITEUP_CATEGORIES } from "@/lib/domain/coachWriteups";

export const dynamic = "force-dynamic";
export const metadata = { title: "My write-ups" };

const LABEL = new Map(WRITEUP_CATEGORIES.map((c) => [c.value, c.label]));
const TONE: Record<string, string> = {
  COMMENDATION: "bg-emerald-100 text-emerald-800",
  TARDINESS: "bg-amber-100 text-amber-800",
  ATTENDANCE: "bg-amber-100 text-amber-800",
  CONDUCT: "bg-rose-100 text-rose-800",
  PERFORMANCE: "bg-slate-100 text-slate-700",
  NOTE: "bg-slate-100 text-slate-700",
  OTHER: "bg-slate-100 text-slate-700",
};
function fmt(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" });
}

export default async function MyWriteupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const writeups = session.personId
    ? await prisma.coachWriteup.findMany({
        where: { personId: session.personId, sharedWithCoachAt: { not: null } },
        orderBy: { occurredAt: "desc" },
        take: 200,
      })
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title="My write-ups" subtitle="Notes the Director has shared with you. Acknowledging one lets the Director know you've seen it." />

      {sp.wuok === "acked" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Thanks — your acknowledgment was recorded.</div>
      )}
      {sp.wuerr === "auth" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">That write-up isn't available to acknowledge.</div>
      )}

      {writeups.length === 0 ? (
        <div className="card text-sm text-slate-500">Nothing shared with you right now.</div>
      ) : (
        <ul className="space-y-2">
          {writeups.map((w) => (
            <li key={w.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[w.category] ?? TONE.NOTE}`}>{LABEL.get(w.category) ?? w.category}</span>
                  <span className="text-sm font-medium text-slate-700">{fmt(w.occurredAt)}</span>
                </div>
                {w.acknowledgedAt ? (
                  <span className="text-[11px] font-semibold text-emerald-600">✓ acknowledged {fmt(w.acknowledgedAt)}</span>
                ) : (
                  <span className="text-[11px] font-semibold text-amber-600">Awaiting your acknowledgment</span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-700">{w.notes}</p>
              {!w.acknowledgedAt && (
                <form method="POST" action="/api/console/coach-writeup" className="mt-2">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="acknowledge" />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="btn-primary text-sm">Acknowledge</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
