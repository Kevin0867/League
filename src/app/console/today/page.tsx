import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { coachedTeamIds } from "@/lib/domain/coachingAccess";
import { formatTime12, formatSessionDay, phoenixDateInput } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

// The coach's day, one screen: the class to run right now with a big check-in,
// anything left un-recorded, and what's next — so "check players in" is the first
// thing on the phone, not three taps down.
export default async function TodayPage() {
  const session = await requireStaff();
  const roles = session.roles ?? [session.role];
  const teamIds = await coachedTeamIds();

  const today = phoenixDateInput(new Date());
  const now = new Date();
  const from = new Date(now.getTime() - 21 * 86400000);
  const to = new Date(now.getTime() + 21 * 86400000);

  const sessions = teamIds.length
    ? await prisma.session.findMany({
        where: {
          teams: { some: { teamId: { in: teamIds } } },
          date: { gte: from, lte: to },
          status: { in: ["SCHEDULED", "DELIVERED", "RESCHEDULED"] },
        },
        include: {
          facility: { select: { name: true } },
          teams: { include: { team: { select: { name: true, _count: { select: { members: true } } } } } },
          _count: { select: { attendance: true } },
        },
        orderBy: { date: "asc" },
      })
    : [];

  const dayOf = (d: Date) => phoenixDateInput(d);
  const todays = sessions.filter((s) => dayOf(s.date) === today);
  const startOfToday = today;
  const needsAttendance = sessions
    .filter((s) => s.status === "SCHEDULED" && dayOf(s.date) < startOfToday && s._count.attendance === 0)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const upcoming = sessions.filter((s) => dayOf(s.date) > startOfToday).slice(0, 3);

  const rosterOf = (s: (typeof sessions)[number]) => s.teams.reduce((n, t) => n + t.team._count.members, 0);
  const namesOf = (s: (typeof sessions)[number]) => s.teams.map((t) => t.team.name).join(", ") || "Class";

  const niceToday = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Phoenix" });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Today</h1>
        <p className="text-sm text-slate-500">{niceToday}</p>
      </div>

      {teamIds.length === 0 ? (
        <div className="card text-sm text-slate-500">
          You&apos;re not assigned to any teams yet. An admin adds you as a team&apos;s coach.
        </div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Today&apos;s classes</h2>
            {todays.length === 0 ? (
              <div className="card text-sm text-slate-500">No class today. Enjoy the day off — your next class is below.</div>
            ) : (
              <div className="space-y-3">
                {todays.map((s) => {
                  const roster = rosterOf(s);
                  const checked = s._count.attendance;
                  return (
                    <div key={s.id} className="card">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-bold text-slate-900">{namesOf(s)}</div>
                          <div className="mt-0.5 text-sm text-slate-600">
                            {formatTime12(s.startTime)} · {s.facility?.name ?? "location TBA"}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {checked > 0 ? `${checked}/${roster} checked in` : `${roster} players · not started`}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link href={`/console/schedule/${s.id}#attendance`} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
                          Check players in →
                        </Link>
                        {s.teams[0] && (
                          <Link href={`/console/teams/${s.teams[0].teamId}/progress`} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            Notes &amp; message
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {needsAttendance.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">Needs attendance</h2>
              <div className="space-y-2">
                {needsAttendance.map((s) => (
                  <Link
                    key={s.id}
                    href={`/console/schedule/${s.id}#attendance`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 active:bg-amber-100"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{namesOf(s)}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{formatSessionDay(s.date, "short")} · {formatTime12(s.startTime)}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Check in →</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Coming up</h2>
              <div className="card divide-y divide-slate-100">
                {upcoming.map((s) => (
                  <Link key={s.id} href={`/console/schedule/${s.id}`} className="flex items-center justify-between gap-2 py-2 active:bg-slate-50">
                    <span className="text-sm text-slate-700">{formatSessionDay(s.date, "short")} · {formatTime12(s.startTime)} · {namesOf(s)}</span>
                    <span className="text-xs font-semibold text-brand-600">Open →</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
