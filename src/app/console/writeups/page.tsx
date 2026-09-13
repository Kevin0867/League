import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { WRITEUP_CATEGORIES } from "@/lib/domain/coachWriteups";

export const dynamic = "force-dynamic";
export const metadata = { title: "Write-ups" };

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

export default async function WriteupsOverviewPage() {
  await requireAdmin();

  const writeups = await prisma.coachWriteup.findMany({ orderBy: { occurredAt: "desc" }, take: 300 });
  const personIds = Array.from(new Set(writeups.map((w) => w.personId)));
  const people = personIds.length
    ? await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

  const total = writeups.length;
  const sharedCount = writeups.filter((w) => w.sharedWithCoachAt).length;
  const ackCount = writeups.filter((w) => w.acknowledgedAt).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Coach write-ups" subtitle="Every note across all coaches, newest first. Admin-only. Open a coach to add or edit their notes." />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><div className="text-2xl font-bold text-slate-900">{total}</div><div className="text-xs text-slate-500">Total write-ups</div></div>
        <div className="card"><div className="text-2xl font-bold text-slate-900">{sharedCount}</div><div className="text-xs text-slate-500">Shared with the coach</div></div>
        <div className="card"><div className="text-2xl font-bold text-slate-900">{ackCount}</div><div className="text-xs text-slate-500">Acknowledged by the coach</div></div>
      </div>

      {writeups.length === 0 ? (
        <div className="card text-sm text-slate-500">No write-ups yet. Open any coach and add one from their profile.</div>
      ) : (
        <ul className="space-y-2">
          {writeups.map((w) => (
            <li key={w.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[w.category] ?? TONE.NOTE}`}>{LABEL.get(w.category) ?? w.category}</span>
                  <Link href={`/console/coaches/${w.personId}`} className="text-sm font-semibold text-brand-700 hover:underline">
                    {nameOf.get(w.personId) ?? "Coach"}
                  </Link>
                  <span className="text-sm text-slate-500">{fmt(w.occurredAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-semibold">
                  {w.acknowledgedAt ? (
                    <span className="text-emerald-600">✓ acknowledged</span>
                  ) : w.sharedWithCoachAt ? (
                    <span className="text-amber-600">shared · not acknowledged</span>
                  ) : (
                    <span className="text-slate-400">private (not shared)</span>
                  )}
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-700">{w.notes}</p>
              <div className="mt-1 text-[11px] text-slate-400">{w.authorName ? `by ${w.authorName}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
