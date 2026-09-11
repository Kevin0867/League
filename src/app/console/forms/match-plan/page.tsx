import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formTeamOptions } from "@/lib/domain/formsAccess";
import { MATCH_PLAN_SECTIONS, type MatchPlanData } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Match Plan" };

export default async function MatchPlanPage({
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
    ? await prisma.coachingFormDoc.findUnique({ where: { teamId_formSlug: { teamId: selectedId, formSlug: "match-plan" } } })
    : null;
  const data = (doc?.data as MatchPlanData | undefined) ?? {};

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Team Match Plan" subtitle="Lay out the plan for the match — serving and return targets, what to attack, and how you'll play transition and the kitchen. Saved per team." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/match-plan" className="card flex flex-wrap items-end gap-3">
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
        <div className="card text-sm text-slate-400">Pick a team to build the match plan.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveMatchPlan" />
          <input type="hidden" name="formSlug" value="match-plan" />
          <input type="hidden" name="teamId" value={selectedId} />

          <div className="card space-y-4">
            {MATCH_PLAN_SECTIONS.map((s) => (
              <div key={s.key}>
                <label className="label">{s.label}</label>
                {s.hint && <p className="mb-1 text-xs text-slate-400">{s.hint}</p>}
                <textarea name={`mp_${s.key}`} defaultValue={data[s.key] ?? ""} rows={s.key === "notes" ? 3 : 2} className="input" />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end">
            <button className="btn-primary">Save match plan</button>
          </div>
        </form>
      )}
    </div>
  );
}
