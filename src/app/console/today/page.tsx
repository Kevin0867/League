import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { TeamColorDot } from "@/components/TeamColorDot";
import { formatTime12, formatSessionDay, phoenixDateInput } from "@/lib/time";
import { phoenixWallTimeToUtc } from "@/lib/domain/ics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

// The coach's home: today up top, then a card for each of their teams in the
// order those teams next meet. Tap any team to take the right action —
// check players in, take notes, message — and come back here. This is the
// landing screen a coach sees on sign-in.
export default async function TodayPage() {
  const session = await requireStaff();
  const coach = session.personId
    ? await prisma.coach.findUnique({ where: { personId: session.personId }, select: { id: true } })
    : null;

  const teams = coach
    ? await prisma.team.findMany({
        where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
        select: { id: true, name: true, color: true, dayOfWeek: true, startTime: true, facility: { select: { name: true } }, _count: { select: { members: true } } },
        orderBy: { name: "asc" },
      })
    : [];
  const teamIds = teams.map((t) => t.id);

  const today = phoenixDateInput(new Date());
  const from = new Date(Date.now() - 21 * 86400000);
  const sessions = teamIds.length
    ? await prisma.session.findMany({
        where: {
          teams: { some: { teamId: { in: teamIds } } },
          type: "PRACTICE",
          status: { in: ["SCHEDULED", "DELIVERED", "RESCHEDULED"] },
          date: { gte: from },
        },
        include: { facility: { select: { name: true } }, teams: { select: { teamId: true } }, _count: { select: { attendance: true } } },
        orderBy: { date: "asc" },
      })
    : [];

  // Each team's card features its NEXT class (today or later), and the whole list
  // is ordered strictly by that class's date + start time — the soonest first, so
  // today's earliest class leads, then the next, and so on. A team whose only
  // open item is an un-recorded past practice shows that (needs attendance) and
  // sorts after the forward schedule; teams with nothing scheduled sort last.
  // `instant` turns a session's day + Phoenix start time into a true timestamp so
  // start time — not just the date — drives the order.
  type Kind = "today" | "attention" | "upcoming" | "none";
  const instant = (s: { date: Date; startTime: string }) => phoenixWallTimeToUtc(s.date, s.startTime).getTime();
  const cards = teams.map((t) => {
    const mine = sessions.filter((s) => s.teams.some((x) => x.teamId === t.id));
    const next = mine
      .filter((s) => phoenixDateInput(s.date) >= today)
      .sort((a, b) => instant(a) - instant(b))[0];
    const overdue = mine
      .filter((s) => phoenixDateInput(s.date) < today && s.status === "SCHEDULED" && s._count.attendance === 0)
      .sort((a, b) => instant(b) - instant(a))[0];
    const pick = next ?? overdue ?? null;
    const kind: Kind = !pick ? "none" : phoenixDateInput(pick.date) === today ? "today" : phoenixDateInput(pick.date) > today ? "upcoming" : "attention";
    // Forward classes (today + upcoming) order by their real start instant.
    // Needs-attention (past) sorts after the forward list; none last.
    const sortKey = kind === "attention" ? 8e15 + instant(pick!) : kind === "none" ? 9e15 : instant(pick!);
    return { team: t, pick, kind, sortKey, checked: pick?._count.attendance ?? 0 };
  });
  cards.sort((a, b) => a.sortKey - b.sortKey);

  const todayCount = cards.filter((c) => c.kind === "today").length;
  const niceToday = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Phoenix" });
  const summary =
    teams.length === 0 ? ""
    : todayCount > 0 ? `You have ${todayCount} class${todayCount === 1 ? "" : "es"} today.`
    : "No classes today — your teams and their next practices are below.";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Quick access to the two coach documents — handbook (read) and the
          incident report (fill + submit). Kept at the very top so they're one
          tap from login. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/console/handbook"
          className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-white px-4 py-4 shadow-sm transition hover:bg-brand-50"
        >
          <div>
            <div className="text-base font-bold text-slate-900">📘 Coaching Handbook</div>
          </div>
          <span className="shrink-0 text-brand-600">→</span>
        </Link>
        <Link
          href="/console/incident-report"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 shadow-sm transition hover:bg-amber-100"
        >
          <div>
            <div className="text-base font-bold text-amber-900">🚑 Incident Report</div>
            <div className="mt-0.5 text-xs text-amber-700">Fill out &amp; submit to the office</div>
          </div>
          <span className="shrink-0 text-amber-700">→</span>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Today</h1>
        <p className="text-sm text-slate-500">{niceToday}{summary ? ` · ${summary}` : ""}</p>
      </div>

      {teams.length === 0 ? (
        <div className="card text-sm text-slate-500">You&rsquo;re not assigned to any teams yet. An admin adds you as a team&rsquo;s coach.</div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your teams</h2>
          {cards.map(({ team, pick, kind, checked }) => {
            const roster = team._count.members;
            const primaryHref = pick ? `/console/schedule/${pick.id}#attendance` : `/console/teams/${team.id}/progress`;
            return (
              <div
                key={team.id}
                className={`card ${kind === "today" ? "border-l-4 border-brand-500" : kind === "attention" ? "border-l-4 border-amber-400" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                      <TeamColorDot color={team.color} size={12} />
                      {team.name}
                    </div>
                    <div className="mt-0.5 text-sm">
                      {kind === "today" && (
                        <span className="font-semibold text-brand-700">
                          Today · {formatTime12(pick!.startTime)}{pick!.facility?.name ? ` · ${pick!.facility.name}` : ""}
                          <span className="ml-2 font-normal text-slate-500">{checked > 0 ? `${checked}/${roster} checked in` : `${roster} players · not started`}</span>
                        </span>
                      )}
                      {kind === "attention" && (
                        <span className="font-semibold text-amber-700">Needs attendance · {formatSessionDay(pick!.date, "short")} · {formatTime12(pick!.startTime)}</span>
                      )}
                      {kind === "upcoming" && (
                        <span className="text-slate-600">Next: {formatSessionDay(pick!.date, "short")} · {formatTime12(pick!.startTime)}{pick!.facility?.name ? ` · ${pick!.facility.name}` : ""}</span>
                      )}
                      {kind === "none" && <span className="text-slate-400">No upcoming practice scheduled</span>}
                    </div>
                  </div>
                  {kind === "today" && <span className="badge bg-brand-100 text-brand-800">Today</span>}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(kind === "today" || kind === "attention") ? (
                    <Link href={primaryHref} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Check players in →</Link>
                  ) : pick ? (
                    <Link href={`/console/schedule/${pick.id}`} className="btn-link">Open session →</Link>
                  ) : null}
                  <Link href={`/console/teams/${team.id}/progress`} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Notes &amp; message</Link>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
