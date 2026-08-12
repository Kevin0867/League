import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canViewTeamNotes } from "@/lib/domain/coachingAccess";
import { COACHING_WEEKS, noteHasContent } from "@/lib/domain/coachingNotes";

export const dynamic = "force-dynamic";

export default async function TeamProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: teamId } = await params;
  if (!(await canViewTeamNotes(teamId))) redirect("/console/teams");

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
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Progress reports</h1>
        <p className="text-sm text-slate-500">
          Six weekly notes per player. Tap a player to add notes and email a weekly update to their parent.
        </p>
      </div>

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
