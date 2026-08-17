import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { formatTime12 } from "@/lib/time";
import { formatCents } from "@/lib/money";
import { coachAssignmentGate } from "@/lib/domain/teams";
import { ensureCoachCalendarToken } from "@/lib/domain/coachCalendar";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
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

  // Coaches complete the same participation waiver as players — signed for
  // themselves via a tokenized, no-login link. Minted only while unsigned.
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { waiverSignedAt: true } });
  const waiverSigned = !!person?.waiverSignedAt;
  const waiverLink = waiverSigned
    ? "/console/profile"
    : `/waiver/sign?token=${encodeURIComponent(await signWaiverToken(personId))}`;

  // Each step deep-links to the exact section that completes it — the profile
  // sections carry matching anchors (#certification, #locations, …) and the
  // waiver step opens the coach's own tokenized sign page.
  const steps = [
    { done: hasCert, label: "Add your certification & coaching background", href: "/console/profile#certification" },
    { done: hasLocations, label: "Set the locations you can coach", href: "/console/profile#locations" },
    { done: hasDayTimes, label: "Set your day & time availability", href: "/console/profile#availability" },
    { done: gate.ok, label: "Screening cleared (background check)", href: "/console/profile#screening" },
    { done: waiverSigned, label: "Complete your participation waiver", href: waiverLink },
  ];
  const nextIdx = steps.findIndex((s) => !s.done);

  const playersCoached = headTeams.reduce((n, t) => n + t._count.members, 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {firstName}</h1>
        <p className="text-slate-500">Your teams, sessions, and earnings.</p>
      </div>

      {/* Getting started toward "cleared & assignable" */}
      {nextIdx >= 0 && (
        <div className="card border-l-4 border-brand-500">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-brand-900">Finish setting up</h2>
            <span className="text-sm text-slate-500">{steps.filter((s) => s.done).length}/{steps.length} done</span>
          </div>
          <ol className="mt-3 space-y-1">
            {steps.map((s, i) => (
              <li key={i}>
                <Link
                  href={s.href}
                  className={`-mx-2 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 ${i === nextIdx ? "bg-brand-50/60" : ""}`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-emerald-100 text-emerald-700" : i === nextIdx ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}>{s.done ? "✓" : i + 1}</span>
                  <span className={`flex-1 text-sm ${s.done ? "text-slate-500 line-through" : "text-slate-700"}`}>{s.label}</span>
                  {!s.done && <span className="text-xs font-semibold text-brand-600">{i === nextIdx ? "Start →" : "Open"}</span>}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Attendance to record — the day-of task, big tap targets. */}
      {pendingCount > 0 && (
        <div className="card border-l-4 border-amber-400">
          <h2 className="font-semibold text-amber-800">Attendance to record ({pendingCount})</h2>
          <div className="mt-2 space-y-2">
            {pendingAttendance.map((s) => (
              <Link
                key={s.id}
                href={`/console/schedule/${s.id}`}
                className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 active:bg-amber-100"
              >
                <span className="text-sm font-medium text-slate-800">
                  {s.teams.map((t) => t.team.name).join(", ") || "Session"}
                  <span className="ml-2 text-xs font-normal text-slate-500">{s.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" })}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-amber-700">Record →</span>
              </Link>
            ))}
          </div>
          {pendingCount > pendingAttendance.length && (
            <p className="mt-2 text-xs text-slate-400">+ {pendingCount - pendingAttendance.length} more</p>
          )}
        </div>
      )}

      {/* Stats — compact, three across even on small screens. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Teams" value={headTeams.length} />
        <Stat label="Players" value={playersCoached} />
        <Stat label="Earnings" value={formatCents(earnings._sum.totalCents ?? 0)} />
      </div>

      {/* My teams — the heart of a coach's job. Each team opens straight to
          Message & notes, with attendance and details one tap away. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">My teams</h2>
        {headTeams.length === 0 ? (
          <div className="card text-sm text-slate-500">You&apos;re not assigned to a team yet. Once you&apos;re cleared, an admin can assign you.</div>
        ) : (
          <div className="space-y-3">
            {headTeams.map((t) => (
              <div key={t.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold text-slate-900">{t.name}</div>
                    <div className="mt-0.5 text-sm text-slate-500">
                      {t.facility?.name ?? "Facility TBA"} · {t.dayOfWeek ?? "day TBA"} {formatTime12(t.startTime)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{t._count.members} players</span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Link
                    href={`/console/teams/${t.id}/progress`}
                    className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white active:bg-brand-700"
                  >
                    Message team &amp; notes
                  </Link>
                  <Link
                    href={`/console/teams/${t.id}`}
                    className="flex min-h-[48px] items-center justify-center rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 active:bg-slate-200"
                  >
                    Team &amp; roster
                  </Link>
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
              <Link key={s.id} href={`/console/schedule/${s.id}`} className="flex min-h-[48px] items-center justify-between gap-2 py-2.5 active:bg-slate-50">
                <span className="text-sm font-medium text-slate-800">
                  {s.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Phoenix" })} · {formatTime12(s.startTime)}
                </span>
                <span className="truncate text-right text-sm text-slate-500">{s.teams.map((t) => t.team.name).join(", ")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Calendar subscription — keeps their phone in sync automatically */}
      {feedUrl && (
        <div className="card">
          <h2 className="font-semibold text-slate-900">Your calendar on your phone</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Subscribe once and your practices, matches, and lessons stay in sync automatically.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {webcalUrl && (
              <a href={webcalUrl} className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white active:bg-brand-700">
                Add to phone
              </a>
            )}
            <a href={feedUrl} className="flex min-h-[48px] items-center justify-center rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 active:bg-slate-200">
              Download .ics
            </a>
          </div>
          <div className="mt-3">
            <p className="mb-1 text-xs text-slate-500">Or add by URL (Apple/Google Calendar → Add → From URL):</p>
            <CopyLink value={feedUrl} />
          </div>
        </div>
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
