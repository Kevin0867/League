import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { canViewTeamNotes } from "@/lib/domain/coachingAccess";
import { COACHING_WEEKS, noteHasContent } from "@/lib/domain/coachingNotes";
import { TeamUpdateComposer } from "@/components/TeamUpdateComposer";
import { formatDate, formatTime12 } from "@/lib/time";

export const dynamic = "force-dynamic";

function startOfTomorrow() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

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

  // The team's sessions, split into "needs attendance now" (today or overdue,
  // still SCHEDULED) and the next few upcoming — so a coach checks players in
  // from the same page they message and take notes on.
  const sessions = await prisma.session.findMany({
    where: { teams: { some: { teamId } } },
    include: { facility: { select: { name: true } }, _count: { select: { attendance: true } } },
    orderBy: { date: "asc" },
  });
  const tomorrow = startOfTomorrow();
  const needsAttendance = sessions
    .filter((s) => s.status === "SCHEDULED" && s.date < tomorrow)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const upcoming = sessions.filter((s) => s.date >= tomorrow).slice(0, 3);
  const rosterSize = team.members.length;

  // Index notes by person → week for the completion strip.
  const notesByPerson = new Map<string, Map<number, { strengths: string; growth: string; note: string | null; sentToParentAt: Date | null }>>();
  for (const n of team.coachingNotes) {
    if (!notesByPerson.has(n.personId)) notesByPerson.set(n.personId, new Map());
    notesByPerson.get(n.personId)!.set(n.week, n);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/console/teams/${teamId}`} className="text-sm text-brand-600 hover:underline">← {team.name}</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{team.name}</h1>
        <p className="text-sm text-slate-500">Check players in, message your team, and keep notes — all here.</p>
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

      {/* CHECK PLAYERS IN — the day-of task, first and biggest. */}
      <section id="checkin" className="scroll-mt-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Check players in</h2>
        {needsAttendance.length === 0 && upcoming.length === 0 ? (
          <div className="card text-sm text-slate-500">No practices scheduled for this team yet.</div>
        ) : (
          <div className="space-y-2">
            {needsAttendance.map((s) => (
              <Link
                key={s.id}
                href={`/console/schedule/${s.id}`}
                className="flex min-h-[64px] items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 active:bg-amber-100"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {s.date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/Phoenix" })}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatTime12(s.startTime)} · {s.facility?.name ?? "location TBA"} · {s._count.attendance > 0 ? `${s._count.attendance}/${rosterSize} checked` : "not started"}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Check in →</span>
              </Link>
            ))}
            {upcoming.length > 0 && (
              <div className="card">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming</div>
                <div className="mt-1 divide-y divide-slate-100">
                  {upcoming.map((s) => (
                    <Link key={s.id} href={`/console/schedule/${s.id}`} className="flex min-h-[44px] items-center justify-between gap-2 py-2 active:bg-slate-50">
                      <span className="text-sm text-slate-700">
                        {s.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Phoenix" })} · {formatTime12(s.startTime)}
                      </span>
                      <span className="text-xs font-semibold text-brand-600">Open →</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* MESSAGE THE TEAM — one message to every player + parent. */}
      <section id="message" className="scroll-mt-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Message the team</h2>
        <div className="card">
          <p className="mb-3 text-sm text-slate-500">
            Sends to every player and parent on {team.name}. Tap the mic to dictate, then edit before sending.
          </p>
          <TeamUpdateComposer ticket={ticket} teamId={teamId} teamName={team.name} />
        </div>
      </section>

      {/* PLAYER NOTES — tappable per-player rows with a weekly progress strip. */}
      <section id="notes" className="scroll-mt-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Player notes</h2>
        <div className="card">
          {team.members.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No players on this roster yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {team.members.map((m) => {
                const weeks = notesByPerson.get(m.personId);
                return (
                  <Link
                    key={m.id}
                    href={`/console/teams/${teamId}/progress/${m.personId}`}
                    className="flex min-h-[56px] items-center justify-between gap-3 py-3 active:bg-slate-50"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{m.person.firstName} {m.person.lastName}</div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {COACHING_WEEKS.map((w) => {
                          const n = weeks?.get(w);
                          const has = n ? noteHasContent(n) : false;
                          const sent = !!n?.sentToParentAt;
                          return (
                            <span
                              key={w}
                              title={`Week ${w}: ${sent ? "sent to parent" : has ? "notes saved" : "nothing yet"}`}
                              className={`grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold ${sent ? "bg-emerald-100 text-emerald-700" : has ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-300"}`}
                            >
                              {w}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-brand-600">Open →</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          <span className="mr-1 font-bold text-emerald-600">●</span> sent to parent ·
          <span className="mx-1 font-bold text-amber-600">●</span> notes saved, not yet sent ·
          <span className="mx-1 font-bold text-slate-300">●</span> nothing yet
        </p>
      </section>
    </div>
  );
}
