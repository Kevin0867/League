import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { canCoverTeamNotes } from "@/lib/domain/coachingAccess";
import { COACHING_WEEKS, COACHING_WEEK_COUNT, noteHasContent } from "@/lib/domain/coachingNotes";
import { TeamUpdateComposer } from "@/components/TeamUpdateComposer";
import { formatTime12, BUSINESS_TZ } from "@/lib/time";
import { teamWeekSchedule, describeTeamPractice } from "@/lib/domain/practiceInfo";

export const dynamic = "force-dynamic";

// "Oct 26" in the club's timezone — used for the week-key labels.
function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TZ });
}
// "Sun Oct 26" for the planned-practice list.
function weekdayShort(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: BUSINESS_TZ });
}

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
  if (!(await canCoverTeamNotes(teamId))) redirect("/console/teams");
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

  // The 6-week schedule, so week labels line up with real dates. Prefers
  // generated practice sessions; falls back to the season + this team's day/time
  // (so a team that has a meeting day but no generated sessions still shows a
  // real schedule instead of "nothing scheduled").
  const [{ slots: weekSlots, hasSessions }, practiceLine] = await Promise.all([
    teamWeekSchedule(team, team.seasonId, COACHING_WEEK_COUNT),
    describeTeamPractice(team, team.seasonId),
  ]);
  // Planned meeting days to show when no check-in sessions exist yet.
  const plannedDates = weekSlots.filter((s) => s.date).map((s) => ({ week: s.week, date: s.date as Date }));
  const hasPlan = plannedDates.length > 0;

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
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          <span aria-hidden>🗓</span> Meets {practiceLine}
        </p>
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
          hasPlan ? (
            // No generated check-in sessions yet, but the team has a meeting
            // day/time — show the planned weekly schedule so it's clear the team
            // DOES have practices, and where check-in will appear.
            <div className="card">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Planned practices</div>
              <p className="mt-0.5 text-xs text-slate-500">
                From the season and this team&apos;s day &amp; time. Check-in opens for each date once the schedule is generated on the Schedule page.
              </p>
              <ul className="mt-2 divide-y divide-slate-100">
                {plannedDates.map((p) => (
                  <li key={p.week} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">
                      <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">Wk {p.week}</span>
                      {weekdayShort(p.date)}
                    </span>
                    <span className="text-xs text-slate-500">{team.startTime ? formatTime12(team.startTime) : "time TBA"}</span>
                  </li>
                ))}
              </ul>
              <Link href="/console/schedule" className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:underline">
                Generate the schedule →
              </Link>
            </div>
          ) : (
            <div className="card text-sm text-slate-500">
              No practices scheduled for this team yet. Set this team&apos;s day, time, and facility on its{" "}
              <Link href={`/console/teams/${teamId}`} className="text-brand-600 hover:underline">team page</Link>, then generate the schedule.
            </div>
          )
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

      {/* PLAYER NOTES — one row per player with an aligned weekly progress grid.
          A week-key header maps each week to its real date (from the schedule),
          so the columns are self-explanatory. */}
      <section id="notes" className="scroll-mt-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Player notes — by week</h2>
        <div className="card overflow-x-auto p-0">
          {team.members.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No players on this roster yet.</p>
          ) : (
            <div className="min-w-[440px]">
              {/* Week-key header: Wk 1 · Oct 26, Wk 2 · Nov 2, … */}
              <div className="grid items-end gap-1 border-b border-slate-200 bg-slate-50/70 px-4 py-2" style={{ gridTemplateColumns: `minmax(7rem,1fr) repeat(${COACHING_WEEK_COUNT}, minmax(0,1fr))` }}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Player</div>
                {weekSlots.map((s) => (
                  <div key={s.week} className="text-center leading-tight">
                    <div className="text-xs font-bold text-slate-700">Wk {s.week}</div>
                    {s.date && <div className="text-[10px] text-slate-400">{shortDate(s.date)}</div>}
                  </div>
                ))}
              </div>
              {/* One row per player: name + 6 status cells aligned to the header. */}
              <div className="divide-y divide-slate-100">
                {team.members.map((m) => {
                  const weeks = notesByPerson.get(m.personId);
                  return (
                    <Link
                      key={m.id}
                      href={`/console/teams/${teamId}/progress/${m.personId}`}
                      className="grid min-h-[52px] items-center gap-1 px-4 py-2.5 active:bg-slate-50 hover:bg-slate-50"
                      style={{ gridTemplateColumns: `minmax(7rem,1fr) repeat(${COACHING_WEEK_COUNT}, minmax(0,1fr))` }}
                    >
                      <div className="pr-2">
                        <div className="truncate text-sm font-semibold text-slate-800">{m.person.firstName} {m.person.lastName}</div>
                        <div className="text-xs font-semibold text-brand-600">Open →</div>
                      </div>
                      {COACHING_WEEKS.map((w) => {
                        const n = weeks?.get(w);
                        const has = n ? noteHasContent(n) : false;
                        const sent = !!n?.sentToParentAt;
                        const label = sent ? "sent to parent" : has ? "notes saved, not sent" : "nothing yet";
                        return (
                          <div key={w} className="flex justify-center" title={`Week ${w}: ${label}`}>
                            <span
                              className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                                sent ? "bg-emerald-500 text-white" : has ? "bg-amber-400 text-white" : "border border-dashed border-slate-300 text-slate-300"
                              }`}
                            >
                              {sent ? "✓" : has ? "•" : ""}
                            </span>
                          </div>
                        );
                      })}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[9px] text-white">✓</span> sent to parent</span>
          <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded-full bg-amber-400 text-[9px] text-white">•</span> notes saved, not yet sent</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded-full border border-dashed border-slate-300" /> nothing yet</span>
          {!hasSessions && hasPlan && <span className="text-slate-400">Week dates are planned from the season &amp; this team&apos;s day/time.</span>}
        </div>
      </section>
    </div>
  );
}
