import { WRITEUP_CATEGORIES } from "@/lib/domain/coachWriteups";

type Writeup = {
  id: string;
  occurredAt: Date;
  category: string;
  notes: string;
  authorName: string | null;
  sharedWithCoachAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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

// Phoenix wall-clock value for a datetime-local input, e.g. 2026-09-13T17:00.
function toInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
function fmt(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" });
}

export function CoachWriteups({
  personId, coachName, writeups, ticket, ok, err,
}: {
  personId: string;
  coachName: string;
  writeups: Writeup[];
  ticket: string;
  ok?: string;
  err?: string;
}) {
  const now = toInput(new Date());
  return (
    <section className="card border-l-4 border-slate-300">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-900">🗒️ Coach write-ups &amp; notes</h2>
          <p className="text-xs text-slate-500">Admin-only. Not visible to the coach unless you share it.</p>
        </div>
        <span className="badge bg-slate-100 text-slate-500">Admin only</span>
      </div>

      {ok && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {ok === "added" ? "Write-up added." : ok === "saved" ? "Write-up updated." : ok === "deleted" ? "Write-up deleted." : ok === "shared" ? "Shared with the coach (text + email + in-app)." : ok === "sharedadmins" ? "Shared with admins." : "Done."}
      </div>}
      {err && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err === "auth" ? "You don't have permission." : err === "notes" ? "Add a note before saving." : "Something went wrong."}</div>}

      {/* New write-up */}
      <form method="POST" action="/api/console/coach-writeup" className="mt-3 space-y-2 rounded-lg border border-slate-200 p-3">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="create" />
        <input type="hidden" name="personId" value={personId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label">Date &amp; time</label>
            <input type="datetime-local" name="occurredAt" defaultValue={now} className="input" />
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
          <textarea name="notes" rows={3} required className="input" placeholder={`e.g. ${coachName} arrived 20 minutes late to the 8:00 AM practice…`} />
        </div>
        <div className="flex justify-end">
          <button className="btn-primary text-sm">Add write-up</button>
        </div>
      </form>

      {/* History */}
      {writeups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No write-ups yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {writeups.map((w) => (
            <li key={w.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[w.category] ?? TONE.NOTE}`}>{LABEL.get(w.category) ?? w.category}</span>
                  <span className="text-sm font-medium text-slate-700">{fmt(w.occurredAt)}</span>
                  {w.acknowledgedAt ? (
                    <span className="text-[11px] font-semibold text-emerald-600">✓ acknowledged {fmt(w.acknowledgedAt)}</span>
                  ) : w.sharedWithCoachAt ? (
                    <span className="text-[11px] font-semibold text-amber-600">shared · awaiting acknowledgment</span>
                  ) : null}
                </div>
                <span className="text-[11px] text-slate-400">{w.authorName ? `by ${w.authorName} · ` : ""}{w.createdAt.getTime() !== w.updatedAt.getTime() ? "edited " : "added "}{fmt(w.updatedAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-700">{w.notes}</p>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {/* Edit (collapsible) */}
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">Edit</summary>
                  <form method="POST" action="/api/console/coach-writeup" className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="update" />
                    <input type="hidden" name="personId" value={personId} />
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
                  <input type="hidden" name="personId" value={personId} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs font-semibold text-brand-700 hover:underline">{w.sharedWithCoachAt ? "Re-share with coach" : "Share with coach"}</button>
                </form>

                {/* Share with admins */}
                <form method="POST" action="/api/console/coach-writeup" className="inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="shareAdmins" />
                  <input type="hidden" name="personId" value={personId} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs font-semibold text-slate-500 hover:text-brand-700 hover:underline">Share with admins</button>
                </form>

                {/* Delete */}
                <form method="POST" action="/api/console/coach-writeup" className="ml-auto inline">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="delete" />
                  <input type="hidden" name="personId" value={personId} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs text-rose-600 hover:underline">Delete</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
