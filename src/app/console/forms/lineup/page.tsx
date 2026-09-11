import Link from "next/link";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formTeamOptions } from "@/lib/domain/formsAccess";
import { LINEUP_LINES, type LineupData } from "@/lib/domain/coachingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "League Lineup Worksheet" };

const LINES = Array.from({ length: LINEUP_LINES }, (_, i) => i);

export default async function LineupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const teamOptions = await formTeamOptions(session);
  const selectedId = sp.team && teamOptions.some((t) => t.id === sp.team) ? sp.team : "";

  const roster = selectedId
    ? await prisma.teamMember.findMany({
        where: { teamId: selectedId, roleOnTeam: "PLAYER" },
        include: { person: { select: { firstName: true, lastName: true } } },
        orderBy: { person: { firstName: "asc" } },
      })
    : [];
  const rosterNames = roster.map((m) => `${m.person.firstName} ${m.person.lastName}`);

  const doc = selectedId
    ? await prisma.coachingFormDoc.findUnique({ where: { teamId_formSlug: { teamId: selectedId, formSlug: "lineup" } } })
    : null;
  const data = (doc?.data as LineupData | undefined) ?? undefined;
  const line = (i: number) => data?.lines?.[i] ?? { playerA: "", playerB: "", note: "" };

  return (
    <div className="space-y-5">
      <Link href="/console/forms" className="btn-back">← All forms</Link>
      <PageHeader title="League Lineup Worksheet" subtitle="Set your lines 1–4 with the pairing and a matchup note for each. Saved per team." />

      {sp.ok && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{sp.err === "auth" ? "You can only edit your own teams." : "Something went wrong — try again."}</div>}

      <form method="GET" action="/console/forms/lineup" className="card flex flex-wrap items-end gap-3">
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
        <div className="card text-sm text-slate-400">Pick a team to set the lineup.</div>
      ) : (
        <form method="POST" action="/api/console/forms" className="space-y-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="saveLineup" />
          <input type="hidden" name="formSlug" value="lineup" />
          <input type="hidden" name="teamId" value={selectedId} />
          {rosterNames.length > 0 && (
            <datalist id="roster">
              {rosterNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          )}

          <div className="card grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Opponent</label>
              <input name="opponent" defaultValue={data?.opponent ?? ""} className="input" placeholder="Opponent team" />
            </div>
            <div>
              <label className="label">Match date</label>
              <input name="matchDate" defaultValue={data?.matchDate ?? ""} className="input" placeholder="e.g. Sat Oct 4" />
            </div>
          </div>

          <div className="card space-y-3">
            {LINES.map((i) => {
              const l = line(i);
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Line {i + 1}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input list="roster" name={`line_${i}_a`} defaultValue={l.playerA} className="input" placeholder="Player A" />
                    <input list="roster" name={`line_${i}_b`} defaultValue={l.playerB} className="input" placeholder="Player B" />
                    <input name={`line_${i}_note`} defaultValue={l.note} className="input" placeholder="Matchup note" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <label className="label">Overall notes</label>
            <textarea name="notes" defaultValue={data?.notes ?? ""} rows={3} className="input" placeholder="Substitution plan, order of play, reminders…" />
          </div>

          <div className="flex items-center justify-end">
            <button className="btn-primary">Save worksheet</button>
          </div>
        </form>
      )}
    </div>
  );
}
