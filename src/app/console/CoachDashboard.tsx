import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { formatTime12 } from "@/lib/time";
import { formatCents } from "@/lib/money";
import { coachAssignmentGate } from "@/lib/domain/teams";
import { ensureCoachCalendarToken } from "@/lib/domain/coachCalendar";
import { CopyLink } from "@/components/CopyLink";

function parseMarkets(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// A coach's own home — their teams, sessions that still need attendance,
// earnings to date, and a getting-started checklist toward "cleared &
// assignable". Replaces the admin season dashboard for COACH logins.
export async function CoachDashboard({ personId, firstName }: { personId: string; firstName: string }) {
  const coach = await prisma.coach.findUnique({
    where: { personId },
    include: { availabilityBlocks: { select: { id: true } } },
  });

  // Personal calendar-subscription feed — an always-in-sync URL for their phone.
  let feedUrl: string | null = null;
  let webcalUrl: string | null = null;
  if (coach) {
    const token = await ensureCoachCalendarToken(coach.id);
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host) {
      feedUrl = `${proto}://${host}/api/calendar/${token}`;
      webcalUrl = `webcal://${host}/api/calendar/${token}`;
    }
  }

  // Sessions still needing attendance: anything scheduled through the end of
  // today (past sessions and today's), so a coach can check players in the day
  // of — not only after the fact.
  const pendingWhere = coach
    ? { coaches: { some: { coachId: coach.id } }, status: "SCHEDULED", date: { lt: startOfTomorrow() } }
    : undefined;
  const [headTeams, upcoming, pendingAttendance, pendingCount, earnings] = coach
    ? await Promise.all([
        prisma.team.findMany({
          where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
          include: { facility: true, _count: { select: { members: true } } },
          orderBy: { name: "asc" },
        }),
        prisma.session.findMany({
          where: { coaches: { some: { coachId: coach.id } }, date: { gte: startOfTomorrow() } },
          include: { facility: true, teams: { include: { team: { select: { name: true } } } } },
          orderBy: { date: "asc" },
          take: 5,
        }),
        prisma.session.findMany({
          where: pendingWhere,
          include: { teams: { include: { team: { select: { name: true } } } } },
          orderBy: { date: "desc" },
          take: 8,
        }),
        prisma.session.count({ where: pendingWhere }),
        prisma.coachPayoutLine.aggregate({ where: { coachId: coach.id }, _sum: { totalCents: true } }),
      ])
    : [[], [], [], 0, { _sum: { totalCents: 0 } }];

  const hasLocations = parseMarkets(coach?.marketsCovered ?? null).length > 0;
  const hasDayTimes = (coach?.availabilityBlocks?.length ?? 0) > 0;
  const hasCert = !!(coach?.rpoCertLevel || coach?.certifications);
  const gate = coach ? coachAssignmentGate(coach) : { ok: false, reasons: ["profile not set up"] };

  const steps = [
    { done: hasCert, label: "Add your certification & coaching background", href: "/console/profile" },
    { done: hasLocations, label: "Set the locations you can coach", href: "/console/profile" },
    { done: hasDayTimes, label: "Set your day & time availability", href: "/console/profile" },
    { done: gate.ok, label: "Screening cleared (background check + onboarding)", href: "/console/profile" },
  ];
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {firstName}</h1>
        <p className="text-slate-500">Your teams, sessions, and earnings at a glance.</p>
      </div>

      {/* Getting started toward "cleared & assignable" */}
      {nextIdx >= 0 && (
        <div className="card border-l-4 border-brand-500">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-brand-900">Finish setting up</h2>
            <span className="text-sm text-slate-500">{steps.filter((s) => s.done).length}/{steps.length} done</span>
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            Next: <Link href={steps[nextIdx].href} className="font-medium text-brand-700 hover:underline">{steps[nextIdx].label}</Link>
          </p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-emerald-100 text-emerald-700" : i === nextIdx ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}>{s.done ? "✓" : i + 1}</span>
                <span className={s.done ? "text-slate-500 line-through" : "text-slate-700"}>{s.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="card border-l-4 border-amber-400">
          <h2 className="font-semibold text-amber-800">Attendance to record ({pendingCount})</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {pendingAttendance.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="text-slate-700">
                  {s.teams.map((t) => t.team.name).join(", ") || "Session"}
                  <span className="ml-2 text-xs text-slate-400">{s.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" })}</span>
                </span>
                <Link href={`/console/schedule/${s.id}`} className="text-xs font-medium text-brand-600 hover:underline">Record →</Link>
              </li>
            ))}
          </ul>
          {pendingCount > pendingAttendance.length && (
            <p className="mt-2 text-xs text-slate-400">+ {pendingCount - pendingAttendance.length} more</p>
          )}
        </div>
      )}

      {/* Calendar subscription — keeps their phone in sync automatically */}
      {feedUrl && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Your calendar</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Subscribe once and your practices, matches, and lessons stay in sync on your phone — new sessions and
                changes show up automatically.
              </p>
            </div>
            <div className="flex gap-2">
              {webcalUrl && <a href={webcalUrl} className="btn-primary text-sm">Add to phone</a>}
              <a href={feedUrl} className="btn-secondary text-sm">Download .ics</a>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            On Apple or Google Calendar you can also add it by URL (Add calendar → From URL):
          </p>
          <div className="mt-1">
            <CopyLink value={feedUrl} />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="My teams" value={headTeams.length} />
        <Stat label="Players coached" value={headTeams.reduce((n, t) => n + t._count.members, 0)} />
        <Stat label="Earnings to date" value={formatCents(earnings._sum.totalCents ?? 0)} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">My teams</h2>
        {headTeams.length === 0 ? (
          <div className="card text-sm text-slate-500">You&apos;re not assigned to a team yet. Once you&apos;re cleared, an admin can assign you.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {headTeams.map((t) => (
              <div key={t.id} className="card">
                <div className="flex items-center justify-between">
                  <Link href={`/console/teams/${t.id}/progress`} className="font-semibold text-slate-800 hover:text-brand-700 hover:underline">{t.name}</Link>
                  <span className="text-xs text-slate-400">{t._count.members} players</span>
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {t.facility?.name ?? "Facility TBA"} · {t.dayOfWeek ?? "day TBA"} {formatTime12(t.startTime)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/console/teams/${t.id}/progress`} className="rounded-md bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700">Message &amp; notes →</Link>
                  <Link href={`/console/teams/${t.id}`} className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">Team details</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Upcoming sessions</h2>
          <div className="card divide-y divide-slate-100">
            {upcoming.map((s) => (
              <Link key={s.id} href={`/console/schedule/${s.id}`} className="flex items-center justify-between px-1 py-2 text-sm hover:bg-slate-50">
                <span className="text-slate-700">
                  {s.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Phoenix" })} · {formatTime12(s.startTime)}
                </span>
                <span className="text-slate-500">{s.teams.map((t) => t.team.name).join(", ")} · {s.facility?.name ?? "TBA"}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function startOfTomorrow() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-slate-900">{value}</div>
    </div>
  );
}
