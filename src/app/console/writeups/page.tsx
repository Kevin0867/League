import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { WRITEUP_CATEGORIES } from "@/lib/domain/coachWriteups";

export const dynamic = "force-dynamic";
export const metadata = { title: "Write-ups" };

const LABEL = new Map(WRITEUP_CATEGORIES.map((c) => [c.value, c.label]));

// Phoenix wall-clock value for a datetime-local input, e.g. 2026-09-13T17:00.
function toInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
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

export default async function WriteupsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  // Coach picker: everyone with a COACH login plus everyone with a Coach
  // profile (same union the Coaches list uses), so any coach can be written up.
  const [coachUsers, coachProfiles] = await Promise.all([
    prisma.user.findMany({ where: { role: "COACH" }, select: { person: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.coach.findMany({ select: { person: { select: { id: true, firstName: true, lastName: true } } } }),
  ]);
  const coachMap = new Map<string, { id: string; firstName: string; lastName: string }>();
  for (const u of coachUsers) if (u.person) coachMap.set(u.person.id, u.person);
  for (const c of coachProfiles) if (c.person && !coachMap.has(c.person.id)) coachMap.set(c.person.id, c.person);
  const coachOptions = [...coachMap.values()].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
  );

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
      <PageHeader title="Coach write-ups" subtitle="Every note across all coaches, newest first. Admin-only. Add one below, or open a coach to edit their notes." />

      {sp.wuok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        {sp.wuok === "added" ? "Write-up added." : sp.wuok === "saved" ? "Write-up updated." : sp.wuok === "deleted" ? "Write-up deleted." : sp.wuok === "shared" ? "Shared with the coach (text + email + in-app)." : sp.wuok === "sharedadmins" ? "Shared with admins." : "Done."}
      </div>}
      {sp.wuerr && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{sp.wuerr === "notes" ? "Pick a coach and add a note before saving." : "Something went wrong."}</div>}

      {/* Add a write-up — the single entry point that doesn't require hunting for a coach's profile. */}
      <details className="card border-l-4 border-brand-400" open={writeups.length === 0}>
        <summary className="cursor-pointer font-semibold text-slate-900">➕ Add a write-up</summary>
        {coachOptions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No coaches found yet. Add a coach first under Coaches.</p>
        ) : (
          <form method="POST" action="/api/console/coach-writeup" className="mt-3 space-y-2">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="create" />
            <input type="hidden" name="from" value="overview" />
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className="label">Coach</label>
                <select name="personId" required defaultValue="" className="input">
                  <option value="" disabled>Select a coach…</option>
                  {coachOptions.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date &amp; time</label>
                <input type="datetime-local" name="occurredAt" defaultValue={toInput(new Date())} className="input" />
              </div>
              <div>
                <label className="label">Category</label>
                <select name="category" defaultValue="NOTE" className="input">
                  {WRITEUP_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea name="notes" rows={3} required className="input" placeholder="e.g. Arrived 20 minutes late to the 8:00 AM practice…" />
            </div>
            <div className="flex justify-end"><button className="btn-primary text-sm">Add write-up</button></div>
          </form>
        )}
      </details>

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

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {/* Edit (collapsible) */}
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">Edit</summary>
                  <form method="POST" action="/api/console/coach-writeup" className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="update" />
                    <input type="hidden" name="from" value="overview" />
                    <input type="hidden" name="personId" value={w.personId} />
                    <input type="hidden" name="id" value={w.id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input type="datetime-local" name="occurredAt" defaultValue={toInput(w.occurredAt)} className="input py-1 text-sm" />
                      <select name="category" defaultValue={w.category} className="input py-1 text-sm">
                        {WRITEUP_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <textarea name="notes" rows={3} defaultValue={w.notes} required className="input text-sm" />
                    <div className="flex justify-end"><button className="btn-secondary text-xs">Save changes</button></div>
                  </form>
                </details>

                {/* Share with the coach */}
                <form method="POST" action="/api/console/coach-writeup" className="inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="shareCoach" />
                  <input type="hidden" name="from" value="overview" />
                  <input type="hidden" name="personId" value={w.personId} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs font-semibold text-brand-700 hover:underline">{w.sharedWithCoachAt ? "Re-share with coach" : "Share with coach"}</button>
                </form>

                {/* Share with admins */}
                <form method="POST" action="/api/console/coach-writeup" className="inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="shareAdmins" />
                  <input type="hidden" name="from" value="overview" />
                  <input type="hidden" name="personId" value={w.personId} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs font-semibold text-slate-500 hover:text-brand-700 hover:underline">Share with admins</button>
                </form>

                {/* Delete */}
                <form method="POST" action="/api/console/coach-writeup" className="ml-auto inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="delete" />
                  <input type="hidden" name="from" value="overview" />
                  <input type="hidden" name="personId" value={w.personId} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs text-rose-600 hover:underline">Delete</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
