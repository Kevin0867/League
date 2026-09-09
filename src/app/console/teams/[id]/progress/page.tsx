import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { canCoverTeamNotes } from "@/lib/domain/coachingAccess";
import { COACHING_WEEKS, COACHING_WEEK_COUNT, noteHasContent } from "@/lib/domain/coachingNotes";
import { TeamUpdateComposer } from "@/components/TeamUpdateComposer";
import { formatTime12, formatSessionDay } from "@/lib/time";
import { teamWeekSchedule, describeTeamPractice } from "@/lib/domain/practiceInfo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team notes" };

// Session/practice dates are stored as a day anchor (12:00 UTC), so render them
// in UTC — never Phoenix — or a day added at UTC midnight reads a day early.
// "Oct 26" — used for the week-key labels.
function shortDate(d: Date): string {
  return formatSessionDay(d, "none");
}
// "Sun Oct 26" for the planned-practice list.
function weekdayShort(d: Date): string {
  return formatSessionDay(d, "short");
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
  // "Needs attendance" leads with the sessions nearest to now — recent practices
  // still un-recorded — not the oldest one on file. Anything older than a few
  // weeks is stale (a session that was never delivered or cancelled) and drops to
  // a separate, quieter list so it can't hijack the primary check-in card (F-14).
  const recentCutoff = new Date();
  recentCutoff.setHours(0, 0, 0, 0);
  recentCutoff.setDate(recentCutoff.getDate() - 21);
  const pastScheduled = sessions
    .filter((s) => s.status === "SCHEDULED" && s.date < tomorrow)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const needsAttendance = pastScheduled.filter((s) => s.date >= recentCutoff);
  const staleUnrecorded = pastScheduled.filter((s) => s.date < recentCutoff);
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

      {/* Three big green actions — the whole job for a coach, one tap each. */}
      <div className="grid grid-cols-3 gap-2">
        <a href="#checkin" className="flex flex-col items-center justify-center rounded-xl bg-emerald-600 px-2 py-3 text-center text-xs font-semibold leading-tight text-white hover:bg-emerald-700 sm:text-sm">
          <span aria-hidden className="mb-0.5 text-base">✓</span>Check players in
        </a>
        <a href="#notes" className="flex flex-col items-center justify-center rounded-xl bg-emerald-600 px-2 py-3 text-center text-xs font-semibold leading-tight text-white hover:bg-emerald-700 sm:text-sm">
          <span aria-hidden className="mb-0.5 text-base">📝</span>Notes &amp; feedback
        </a>
        <a href="#message" className="flex flex-col items-center justify-center rounded-xl bg-emerald-600 px-2 py-3 text-center text-xs font-semibold leading-tight text-white hover:bg-emerald-700 sm:text-sm">
          <span aria-hidden className="mb-0.5 text-base">💬</span>Message team
        </a>
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
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Practices</div>
              <p className="mt-0.5 text-xs text-slate-500">
                Your team&apos;s practice days from the season and its day &amp; time. Tap <strong>Check in</strong> to open a practice and mark players present or absent.
              </p>
              <ul className="mt-2 divide-y divide-slate-100">
                {plannedDates.map((p) => (
                  <li key={p.week} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-slate-700">
                      <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">Wk {p.week}</span>
                      {weekdayShort(p.date)}
                      <span className="ml-2 text-xs text-slate-400">{team.startTime ? formatTime12(team.startTime) : "time TBA"}</span>
                    </span>
                    <form method="POST" action="/api/console/schedule">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="ensurePractice" />
                      <input type="hidden" name="teamId" value={teamId} />
                      <input type="hidden" name="date" value={p.date.toISOString().slice(0, 10)} />
                      <input type="hidden" name="returnTo" value={`/console/teams/${teamId}/progress`} />
                      <button className="shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white active:bg-brand-700">Check in →</button>
                    </form>
                  </li>
                ))}
              </ul>
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
                    {formatSessionDay(s.date, "long")}
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
                        {formatSessionDay(s.date, "short")} · {formatTime12(s.startTime)}
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

      {/* Stale un-recorded sessions — old practices left SCHEDULED that were never
          recorded or cancelled. Kept out of the primary check-in card, tucked in a
          collapsed list so they don't lead but are still reachable. */}
      {staleUnrecorded.length > 0 && (
        <section className="scroll-mt-4">
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium text-slate-500">
              {staleUnrecorded.length} older session{staleUnrecorded.length === 1 ? "" : "s"} without attendance
            </summary>
            <div className="mt-2 divide-y divide-slate-100">
              {staleUnrecorded.map((s) => (
                <Link key={s.id} href={`/console/schedule/${s.id}`} className="flex min-h-[44px] items-center justify-between gap-2 py-2 active:bg-slate-50">
                  <span className="text-sm text-slate-600">
                    {formatSessionDay(s.date, "short")} · {formatTime12(s.startTime)}
                  </span>
                  <span className="text-xs font-semibold text-brand-600">Open →</span>
                </Link>
              ))}
            </div>
          </details>
        </section>
      )}

      {/* PLAYER NOTES — a clean, tappable list. Each player shows a plain-English
          progress line and a tidy 6-week strip; tap to open and write/send. */}
      <section id="notes" className="scroll-mt-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Notes &amp; feedback for each player</h2>
        {team.members.length === 0 ? (
          <div className="card py-8 text-center text-sm text-slate-500">No players on this roster yet.</div>
        ) : (
          <>
          {/* Key first, so the dots below mean something as you read down. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700">✓</span> sent to parent</span>
            <span className="inline-flex items-center gap-1.5"><span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">•</span> saved, not sent</span>
            <span className="inline-flex items-center gap-1.5"><span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-600">Wk</span> nothing yet</span>
            <span className="text-slate-500">Weeks {weekSlots[0]?.date ? shortDate(weekSlots[0].date) : "1"}–{weekSlots[COACHING_WEEK_COUNT - 1]?.date ? shortDate(weekSlots[COACHING_WEEK_COUNT - 1].date as Date) : COACHING_WEEK_COUNT}{!hasSessions && hasPlan ? " (planned)" : ""}.</span>
          </div>
          <div className="space-y-2">
            {team.members.map((m) => {
              const weeks = notesByPerson.get(m.personId);
              const noted = COACHING_WEEKS.filter((w) => { const n = weeks?.get(w); return n ? noteHasContent(n) : false; }).length;
              const sentCount = COACHING_WEEKS.filter((w) => !!weeks?.get(w)?.sentToParentAt).length;
              const summary =
                noted === 0 ? "No notes yet — tap to start Week 1"
                : `${noted} of ${COACHING_WEEK_COUNT} weeks noted${sentCount ? ` · ${sentCount} sent to parent` : " · none sent yet"}`;
              return (
                <Link
                  key={m.id}
                  href={`/console/teams/${teamId}/progress/${m.personId}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-200 hover:bg-brand-50/40 active:bg-brand-50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{m.person.firstName} {m.person.lastName}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{summary}</div>
                    {/* Tidy week strip — one dot per week, colored by status. */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {weekSlots.map((s) => {
                        const n = weeks?.get(s.week);
                        const has = n ? noteHasContent(n) : false;
                        const sent = !!n?.sentToParentAt;
                        const label = sent ? "sent to parent" : has ? "saved, not sent" : "nothing yet";
                        return (
                          <span
                            key={s.week}
                            title={`Week ${s.week}${s.date ? ` · ${shortDate(s.date)}` : ""}: ${label}`}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              sent ? "bg-emerald-100 text-emerald-700" : has ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"
                            }`}
                          >
                            {sent ? "✓" : has ? "•" : ""} Wk {s.week}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <span className="shrink-0 text-brand-600" aria-hidden>›</span>
                </Link>
              );
            })}
          </div>
          </>
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
    </div>
  );
}
