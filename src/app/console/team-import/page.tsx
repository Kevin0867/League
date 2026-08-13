import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { planRosterImport } from "@/lib/domain/rosterImport";

export const dynamic = "force-dynamic";

// One-time club team-assignment import. Previews the plan built from the Master
// Roster spreadsheet — teams to create, players matched to registrations, and
// anything unmatched — then commits it. Assignment is SILENT: no emails or texts
// go to families when the roster is applied.
export default async function TeamImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const plan = await planRosterImport();

  if (!plan) {
    return <div className="card text-sm text-slate-500">No active PURE Academy season — create/activate a season first.</div>;
  }

  const committed = sp.ok === "1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import team assignments</h1>
        <p className="text-slate-500">
          From the Master Roster spreadsheet, into <span className="font-medium">{plan.seasonName}</span>. Creates the {plan.teams.length} teams
          and places each player on their team. Players are moved <span className="font-medium">silently</span> — no emails or texts are sent.
        </p>
      </div>

      {committed && (
        <div className="rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-900">
          <p className="font-semibold">Import complete.</p>
          <p className="mt-0.5">
            Teams created: {sp.created} · reused: {sp.reused} · players placed: {sp.assigned}
            {sp.skipped && sp.skipped !== "0" ? ` · unmatched skipped: ${sp.skipped}` : ""}. Re-running is safe — it won&apos;t duplicate.
          </p>
        </div>
      )}
      {sp.err === "auth" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Not authorized.</p>}
      {sp.err === "noseason" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">No active season.</p>}

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><div className="text-xs uppercase tracking-wide text-slate-400">Teams</div><div className="text-2xl font-bold text-slate-900">{plan.teams.length}</div></div>
        <div className="card"><div className="text-xs uppercase tracking-wide text-slate-400">Players matched</div><div className="text-2xl font-bold text-emerald-700">{plan.totalMatched}<span className="text-base font-normal text-slate-400"> / {plan.totalPlayers}</span></div></div>
        <div className="card"><div className="text-xs uppercase tracking-wide text-slate-400">Unmatched</div><div className={`text-2xl font-bold ${plan.totalUnmatched ? "text-amber-600" : "text-slate-900"}`}>{plan.totalUnmatched}</div></div>
      </div>

      {/* Unmatched — surfaced up top so nothing is silently dropped */}
      {plan.totalUnmatched > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-semibold text-amber-900">{plan.totalUnmatched} player{plan.totalUnmatched === 1 ? "" : "s"} couldn&apos;t be matched to a registration and will be skipped:</p>
          <p className="mt-1 text-amber-800">{plan.unmatchedNames.join(", ")}</p>
          <p className="mt-1 text-xs text-amber-700">Usually a name that isn&apos;t registered yet, or a spelling difference. Add/fix their registration, then re-run — everyone else still imports.</p>
        </div>
      )}

      {/* Commit */}
      <form method="POST" action="/api/console/team-import" className="card flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="commit" />
        <div className="text-sm text-slate-600">
          {committed ? "Re-run to apply any newly matched players (safe — no duplicates)." : "Review the plan below, then apply it. No notifications are sent."}
        </div>
        <button className="btn-primary">{committed ? "Re-run import" : `Create ${plan.teams.length} teams & place ${plan.totalMatched} players`}</button>
      </form>

      {/* Per-team preview */}
      <div className="space-y-3">
        {plan.teams.map((t) => (
          <div key={t.teamId} className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-slate-900">{t.name}</span>
                <span className="ml-2 text-xs text-slate-400">{t.teamId}{t.category ? ` · ${t.category}` : ""}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {t.existingTeamId ? <span className="badge bg-slate-100 text-slate-600">exists — will reuse</span> : <span className="badge bg-emerald-100 text-emerald-800">new team</span>}
                {!t.divisionId && <span className="badge bg-slate-100 text-slate-500" title="No matching division found — team is created without a division link; set it later.">no division link</span>}
                <span className="text-slate-500">{t.matched}/{t.members.length} matched</span>
              </div>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {t.members.map((m) => (
                <div key={`${t.teamId}-${m.name}`} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm ring-1 ring-slate-100">
                  <span className={m.personId ? "text-slate-700" : "text-amber-700"}>
                    {m.personId ? "✓" : "✗"} {m.name}
                  </span>
                  {m.currentTeamName ? (
                    <span className="text-xs text-slate-400">moving from {m.currentTeamName}</span>
                  ) : !m.personId ? (
                    <span className="text-xs text-amber-600">no registration</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
