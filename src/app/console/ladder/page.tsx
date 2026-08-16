import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  created: "Ladder created.",
  added: "Entry added.",
  removed: "Entry removed.",
  challenge: "Result recorded — the ladder updated.",
  deletedladder: "Ladder deleted.",
};
const ERR: Record<string, string> = {
  auth: "Not authorized.",
  name: "Name the ladder.",
  noladder: "No ladder.",
  entryname: "Enter a name.",
  pickpair: "Pick two different entries.",
  pickwinner: "Pick the winner.",
  op: "Unknown action.",
};

export default async function LadderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const ladder = await prisma.ladder.findFirst({
    where: { active: true },
    include: { entries: { orderBy: { position: "asc" } } },
  });
  const teams = await prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="space-y-6">
      <PageHeader title="Ladder" subtitle="A running ladder — beat someone ranked above you and you take their spot. Record challenge results and the order updates itself." />

      {sp.ok && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok] ?? "Done."}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERR[sp.err] ?? "Something went wrong."}</p>}

      {!ladder ? (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold text-slate-900">Start a ladder</h2>
            <p className="mt-0.5 text-sm text-slate-600">Create a ladder, add players or teams, then record challenge results. Winning against someone above you moves you up.</p>
          </div>
          <form method="POST" action="/api/console/ladder" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="createLadder" />
            <div>
              <label className="label">Ladder name</label>
              <input name="name" className="input min-w-[16rem]" placeholder="Fall Singles Ladder" required />
            </div>
            <button className="btn-primary">Create ladder</button>
          </form>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-900">{ladder.name}</h2>
                <p className="text-xs text-slate-400">{ladder.entries.length} on the ladder</p>
              </div>
              <ConfirmSubmit
                action="/api/console/ladder"
                fields={{ ticket, op: "deleteLadder", ladderId: ladder.id }}
                label="Delete ladder"
                confirm={`Delete "${ladder.name}" and all its entries? This can't be undone.`}
                danger
                className="text-xs text-rose-600 hover:underline"
              />
            </div>

            {ladder.entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No one on the ladder yet — add players or teams below.</p>
            ) : (
              <ol className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-100">
                {ladder.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="flex items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-900 text-xs font-bold text-white">{e.position}</span>
                      <span className="font-medium text-slate-800">{e.name}</span>
                    </span>
                    <span className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="tabular-nums">{e.wins}–{e.losses}</span>
                      <form method="POST" action="/api/console/ladder">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="removeEntry" />
                        <input type="hidden" name="entryId" value={e.id} />
                        <button className="text-rose-600 hover:underline">remove</button>
                      </form>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Add entry */}
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Add to the ladder</h3>
              <form method="POST" action="/api/console/ladder" className="space-y-2">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="addEntry" />
                <input type="hidden" name="ladderId" value={ladder.id} />
                <div>
                  <label className="label">Name <span className="font-normal text-slate-400">(player, pair, or team)</span></label>
                  <input name="name" className="input" placeholder="e.g. Sam & Jordan" />
                </div>
                <div>
                  <label className="label">…or pick a team</label>
                  <select name="teamId" className="input">
                    <option value="">— none —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Picking a team fills the name automatically.</p>
                </div>
                <button className="btn-secondary text-sm">Add to ladder</button>
              </form>
            </div>

            {/* Record challenge */}
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Record a challenge</h3>
              {ladder.entries.length < 2 ? (
                <p className="text-sm text-slate-500">Add at least two entries to record a result.</p>
              ) : (
                <form method="POST" action="/api/console/ladder" className="space-y-2">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="recordChallenge" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="label">Challenger</label>
                      <select name="aId" className="input" required>
                        <option value="">—</option>
                        {ladder.entries.map((e) => <option key={e.id} value={e.id}>#{e.position} {e.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Opponent</label>
                      <select name="bId" className="input" required>
                        <option value="">—</option>
                        {ladder.entries.map((e) => <option key={e.id} value={e.id}>#{e.position} {e.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">Winner</label>
                    <select name="winnerId" className="input" required>
                      <option value="">—</option>
                      {ladder.entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary text-sm">Record result</button>
                  <p className="text-xs text-slate-400">If the lower-ranked entry wins, the two swap positions.</p>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
