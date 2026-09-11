import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formTeamOptions } from "@/lib/domain/formsAccess";
import { PROGRESS_WEEKS, type HomeworkData, type HomeworkWeek } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player Homework & Accountability Log" };

const WEEKS = Array.from({ length: PROGRESS_WEEKS }, (_, i) => i + 1);

export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const teamOptions = await formTeamOptions(session);
  const selectedId = sp.team && teamOptions.some((t) => t.id === sp.team) ? sp.team : "";

  const doc = selectedId
    ? await prisma.coachingFormDoc.findUnique({ where: { teamId_formSlug: { teamId: selectedId, formSlug: "homework" } } })
    : null;
  const data = (doc?.data as HomeworkData | undefined) ?? undefined;
  const wk = (i: number): HomeworkWeek => data?.weeks?.[i] ?? { assignment: "", completed: false, result: "", takeaway: "" };

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Player Homework & Accountability Log" subtitle="Set a weekly assignment, mark whether it was completed, and capture the result and takeaway. Wrap up with a six-week reflection. Saved per team." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/homework" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Team</label>
          <select name="team" defaultValue={selectedId} className="input">
            <option value="">Choose a team…</option>
            {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary text-sm">Open</button>
      </form>

      {!selectedId ? (
        <div className="card text-sm text-slate-400">Pick a team to log homework.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveHomework" />
          <input type="hidden" name="formSlug" value="homework" />
          <input type="hidden" name="teamId" value={selectedId} />

          <div className="space-y-3">
            {WEEKS.map((n) => {
              const w = wk(n - 1);
              return (
                <div key={n} className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Week {n}</div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" name={`hw_${n}_completed`} defaultChecked={w.completed} className="h-4 w-4 rounded border-slate-300" />
                      Completed
                    </label>
                  </div>
                  <div>
                    <label className="label">Assignment</label>
                    <input name={`hw_${n}_assignment`} defaultValue={w.assignment} className="input" placeholder="What we asked them to work on" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="label">Result</label>
                      <input name={`hw_${n}_result`} defaultValue={w.result} className="input" placeholder="What happened" />
                    </div>
                    <div>
                      <label className="label">Takeaway</label>
                      <input name={`hw_${n}_takeaway`} defaultValue={w.takeaway} className="input" placeholder="Key takeaway" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <label className="label">Six-week reflection</label>
            <textarea name="reflection" defaultValue={data?.reflection ?? ""} rows={4} className="input" placeholder="How did the group progress over the six weeks? What's next?" />
          </div>

          <div className="flex items-center justify-end">
            <button className="btn-primary">Save log</button>
          </div>
        </form>
      )}
    </div>
  );
}
