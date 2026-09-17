import Link from "next/link";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { phoenixDateInput, formatTime12 } from "@/lib/time";
import { listTeamCalendar, teamDescription } from "@/lib/domain/teamCalendar";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { CalendarView, type CalEvent } from "@/components/CalendarView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team calendar" };

// Team calendar for staff: admins see any team, a coach sees the teams they
// coach. Day / week / month / year views; clicking a session opens it (where the
// Substitutes card lets you add a sub). Players see their own team's calendar in
// the portal.
export default async function ConsoleTeamCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const admin = isAdmin(session.roles ?? [session.role]);
  const coachedIds = admin ? null : await coachedTeamIdsForUser(session.userId);

  const teams = await prisma.team.findMany({
    where: {
      isTest: false,
      season: { active: true },
      ...(admin ? {} : { id: { in: coachedIds ?? [] } }),
    },
    select: { id: true, name: true, division: { select: { name: true } }, dayOfWeek: true, startTime: true, levelBand: true },
    orderBy: { name: "asc" },
  });

  const selected = sp.team && teams.some((t) => t.id === sp.team) ? sp.team : teams[0]?.id ?? null;
  const selectedTeam = teams.find((t) => t.id === selected) ?? null;
  const cal = selected ? await listTeamCalendar(selected, []) : [];
  const events: CalEvent[] = cal.map((s) => ({
    id: s.id,
    dateISO: phoenixDateInput(s.date),
    time: formatTime12(s.startTime),
    title: s.title,
    tone: s.type === "PRACTICE" ? "practice" : s.type === "LEAGUE_MATCH" ? "league" : s.type === "CHAMPIONSHIP" ? "championship" : "other",
    openSpots: s.openSpots || undefined,
    href: `/console/schedule/${s.id}`,
  }));
  const today = phoenixDateInput(new Date());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Team calendar</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {admin ? "Any team's" : "Your teams'"} practices and events. Click a session to open it — that&apos;s where you add a sub for a date. Players see their own team&apos;s calendar in the portal.
        </p>
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-slate-400">{admin ? "No active teams yet." : "You aren't assigned to any teams yet."}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Team:</span>
            {teams.length > 8 ? (
              <form method="GET" className="contents">
                <select name="team" defaultValue={selected ?? ""} className="input py-1.5 text-sm">
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button className="btn-secondary text-sm">Show</button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {teams.map((t) => (
                  <Link key={t.id} href={`/console/team-calendar?team=${t.id}`} className={`rounded-lg px-2.5 py-1 text-sm ${t.id === selected ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{t.name}</Link>
                ))}
              </div>
            )}
          </div>

          {selectedTeam && (
            <p className="text-xs text-slate-500">
              {teamDescription(selectedTeam)} · <Link href={`/console/teams/${selectedTeam.id}`} className="text-brand-700 hover:underline">team page</Link>
              {" · "}<a href={`/portal/team/${selectedTeam.id}/calendar`} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">player view ↗</a>
            </p>
          )}

          <CalendarView events={events} initialView="month" initialDateISO={today} />
        </>
      )}
    </div>
  );
}
