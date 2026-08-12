import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { canViewTeamNotes } from "@/lib/domain/coachingAccess";
import { COACHING_WEEKS, noteHasContent } from "@/lib/domain/coachingNotes";
import { TeamUpdateComposer } from "@/components/TeamUpdateComposer";

export const dynamic = "force-dynamic";

export default async function TeamProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id: teamId } = await params;
  const sp = await searchParams;
  if (!(await canViewTeamNotes(teamId))) redirect("/console/teams");
  const ticket = await mintConsoleTicket();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: { include: { person: true }, orderBy: { person: { lastName: "asc" } } },
      coachingNotes: true,
    },
  });
  if (!team) notFound();

  // Index notes by person → week for the completion strip.
  const notesByPerson = new Map<string, Map<number, { strengths: string; growth: string; note: string | null; sentToParentAt: Date | null }>>();
  for (const n of team.coachingNotes) {
    if (!notesByPerson.has(n.personId)) notesByPerson.set(n.personId, new Map());
    notesByPerson.get(n.personId)!.set(n.week, n);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/console/teams/${teamId}`} className="text-sm text-brand-600 hover:underline">← {team.name}</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{team.name}</h1>
        <p className="text-sm text-slate-500">Message your team, and keep weekly progress notes per player.</p>
      </div>

      {sp.ok === "teamsent" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Update sent to {sp.n ?? 0} recipient{sp.n === "1" ? "" : "s"}{sp.failed ? ` · ${sp.failed} failed` : ""}
          {sp.reason ? ` — ${sp.reason}` : ""}.
        </div>
      )}
      {sp.err === "empty" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">Write a message before sending.</div>
      )}
      {sp.err === "auth" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">You can only message your own teams.</div>
      )}

      {/* Team update — one message to the whole team (players + parents). */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Message the team</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Sends to every player and parent on {team.name}. Tap the mic to dictate, then edit before sending.
        </p>
        <TeamUpdateComposer ticket={ticket} teamId={teamId} teamName={team.name} />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Progress notes</h2>
      <div className="card overflow-x-auto">
        {team.members.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No players on this roster yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2">Player</th>
                {COACHING_WEEKS.map((w) => <th key={w} className="px-2 text-center">Wk {w}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {team.members.map((m) => {
                const weeks = notesByPerson.get(m.personId);
                return (
                  <tr key={m.id}>
                    <td className="py-2 font-medium">
                      <Link href={`/console/teams/${teamId}/progress/${m.personId}`} className="text-slate-800 hover:text-brand-700 hover:underline">
                        {m.person.firstName} {m.person.lastName}
                      </Link>
                    </td>
                    {COACHING_WEEKS.map((w) => {
                      const n = weeks?.get(w);
                      const has = n ? noteHasContent(n) : false;
                      const sent = !!n?.sentToParentAt;
                      return (
                        <td key={w} className="px-2 text-center">
                          {sent ? <span title="Sent to parent" className="text-emerald-600">✓</span>
                            : has ? <span title="Notes saved" className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                            : <span className="text-slate-300">–</span>}
                        </td>
                      );
                    })}
                    <td className="text-right">
                      <Link href={`/console/teams/${teamId}/progress/${m.personId}`} className="text-xs font-semibold text-brand-600 hover:underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">
        <span className="mr-1 text-emerald-600">✓</span> shared with parent ·
        <span className="mx-1 inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" /> notes saved, not yet sent ·
        <span className="mx-1 text-slate-300">–</span> nothing yet
      </p>
    </div>
  );
}
