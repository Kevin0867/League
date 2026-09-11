import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formTeamOptions } from "@/lib/domain/formsAccess";
import { SCOUTING_SECTIONS, type ScoutingData } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Match-Day Scouting Sheet" };

export default async function ScoutingPage({
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
    ? await prisma.coachingFormDoc.findUnique({ where: { teamId_formSlug: { teamId: selectedId, formSlug: "scouting" } } })
    : null;
  const data = (doc?.data as ScoutingData | undefined) ?? {};

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="Match-Day Scouting Sheet" subtitle="Scout the opponent — strengths, weaknesses, and tendencies — then set the game plan and jot after-match notes. Saved per team." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/scouting" className="card flex flex-wrap items-end gap-3">
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
        <div className="card text-sm text-slate-400">Pick a team to start scouting.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveScouting" />
          <input type="hidden" name="formSlug" value="scouting" />
          <input type="hidden" name="teamId" value={selectedId} />

          <div className="card space-y-4">
            {SCOUTING_SECTIONS.map((s) => (
              <div key={s.key}>
                <label className="label">{s.label}</label>
                <textarea name={`sc_${s.key}`} defaultValue={data[s.key] ?? ""} rows={s.key === "opponent" ? 1 : 2} className="input" />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end">
            <button className="btn-primary">Save scouting sheet</button>
          </div>
        </form>
      )}
    </div>
  );
}
