import Link from "next/link";
import { prisma } from "@/lib/db";
import { teamMissingFields } from "@/lib/domain/teams";
import { getSeasonStats } from "@/lib/domain/seasonStats";
import { StatusBadge } from "@/components/StatusBadge";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { computeEnrollmentBreakdown, type BreakdownRow } from "@/lib/domain/enrollmentBreakdown";
import { CoachDashboard } from "./CoachDashboard";

export default async function ConsoleDashboard() {
  // Coaches get their own home (their teams / sessions / earnings), not the
  // academy-wide admin dashboard.
  const session = await getSession();
  if (session?.role === "COACH" && session.personId) {
    return <CoachDashboard personId={session.personId} firstName={session.name.split(" ")[0]} />;
  }

  // One counting service feeds every headline number and the getting-started
  // checklist, so the dashboard can never disagree with Setup / Teams / Schedule.
  const stats = await getSeasonStats();
  const [teams, coaches, failedPayments] = await Promise.all([
    // Team board preview + compliance snapshot need the rows; scope matches the
    // service (active season, real teams).
    stats.season
      ? prisma.team.findMany({
          where: { seasonId: stats.season.id, isTest: false },
          include: { _count: { select: { members: true } }, facility: true },
        })
      : Promise.resolve([]),
    prisma.coach.findMany(),
    prisma.payment.count({ where: { direction: "IN", status: "FAILED" } }),
  ]);

  const regCount = stats.registrations.live;
  const assignedCount = stats.registrations.assigned;
  const waitlistCount = stats.registrations.waitlisted;
  const waiversOutstanding = stats.waiversOutstanding;
  const executed = stats.facilities.executed;
  const facilitiesTotal = stats.facilities.total;

  // Enrollment breakdown — admins only. Splits live signups by chosen location
  // and by program/skill level (Active vs. Waitlist). Only queried for admins so
  // non-admin staff who reach this dashboard don't pay for it.
  const admin = !!session && isAdmin(session.roles ?? session.role);
  const breakdown = admin
    ? computeEnrollmentBreakdown(
        await prisma.registration.findMany({
          select: {
            status: true,
            programInterest: true,
            skillLevel: true,
            division: { select: { name: true } },
            locationPrefs: { select: { marketName: true, facility: { select: { name: true, market: true } } } },
          },
        }),
      )
    : null;

  const completeTeams = stats.teams.ready;
  const publishedTeams = stats.teams.published;
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  // Expired counts as urgent too — the label reflects both.
  const bgChecksBad = coaches.filter(
    (c) => c.backgroundCheckExpiry && c.backgroundCheckExpiry < soon
  ).length;
  // "Needs attention today" — the prioritized cross-cutting to-do, most urgent
  // first. Each label states exactly what the number counts.
  const attention = [
    { n: failedPayments, label: `failed payment${failedPayments === 1 ? "" : "s"} to follow up on`, href: "/console/payments", tone: "rose" as const },
    { n: waiversOutstanding, label: `registered player${waiversOutstanding === 1 ? "" : "s"} without a signed waiver`, href: "/console/compliance", tone: "amber" as const },
    { n: bgChecksBad, label: `coach background check${bgChecksBad === 1 ? "" : "s"} expired or expiring within 30 days`, href: "/console/coaches", tone: "amber" as const },
  ].filter((a) => a.n > 0);

  // The one getting-started sequence, computed in getSeasonStats so Setup, Teams
  // and Schedule show the exact same checkmarks the dashboard does.
  const setup = stats.readiness;
  const doneCount = setup.filter((s) => s.done).length;
  const nextIdx = setup.findIndex((s) => !s.done);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Season dashboard</h1>
        <p className="text-slate-500">A live read on the build toward Week 1.</p>
      </div>

      {/* Needs attention today — the prioritized cross-cutting to-do list */}
      {attention.length > 0 && (
        <div className="card border-l-4 border-rose-400">
          <h2 className="font-semibold text-slate-900">Needs attention</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {attention.map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex items-center gap-2 hover:underline">
                  <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold ${a.tone === "rose" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{a.n}</span>
                  <span className="text-slate-700">{a.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Getting started — the end-to-end sequence for running a season */}
      <div className="card border-l-4 border-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-brand-900">Getting started</h2>
          <span className="text-sm text-slate-500">{doneCount}/{setup.length} done</span>
        </div>
        {nextIdx >= 0 ? (
          <p className="mt-0.5 text-sm text-slate-600">
            Next: <Link href={setup[nextIdx].href} className="font-medium text-brand-700 hover:underline">{setup[nextIdx].label}</Link>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-emerald-700">Your season is fully set up and published. 🎉</p>
        )}
        <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {setup.map((s, i) => {
            const current = i === nextIdx;
            return (
              <li key={i}>
                <Link href={s.href} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50 ${current ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-emerald-100 text-emerald-700" : current ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className={s.done ? "text-slate-500 line-through" : current ? "font-medium text-slate-800" : "text-slate-600"}>{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registrations" value={regCount} href="/console/registrations" hint={`${assignedCount} assigned · ${waitlistCount} waitlisted`} />
        <Stat label="Teams complete" value={`${completeTeams}/${teams.length}`} href="/console/teams" hint={`${publishedTeams} published`} />
        <Stat label="Facilities executed" value={`${executed}/${facilitiesTotal}`} href="/console/facilities" hint="agreements signed" tone={executed === 0 ? "warn" : "ok"} />
        <Stat label="Waivers outstanding" value={waiversOutstanding} href="/console/compliance" hint="no court-ready roster without one" tone={waiversOutstanding > 0 ? "warn" : "ok"} />
      </div>

      {/* Enrollment breakdown — admins only */}
      {breakdown && (
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Enrollment breakdown</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Based on {breakdown.base} live enrollment{breakdown.base === 1 ? "" : "s"} (withdrawn and duplicate signups
                excluded). A signup that listed more than one location counts once under each, so the location column can add
                up to more than the total.
              </p>
            </div>
            <a href="/console/export/enrollment-breakdown" className="btn-secondary whitespace-nowrap text-sm">Export breakdown</a>
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <BreakdownTable title="By location" rows={breakdown.byLocation} unit="location" />
            <BreakdownTable title="By program / skill level" rows={breakdown.byProgram} unit="program" />
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Team build board preview */}
        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Team build board</h2>
            <Link href="/console/teams" className="text-sm font-medium text-brand-700">Open board →</Link>
          </div>
          {teams.length === 0 ? (
            <Empty text="No teams yet. Assign registered players into pools to form teams." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-2">Team</th>
                    <th>Roster</th>
                    <th>Status</th>
                    <th>Missing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teams.slice(0, 6).map((t) => {
                    const missing = teamMissingFields(t);
                    return (
                      <tr key={t.id}>
                        <td className="py-2 font-medium text-slate-800">{t.name}</td>
                        <td>{t._count.members}{t.coachPlays ? " +C" : ""}</td>
                        <td>{t.published ? <StatusBadge status="PUBLISHED" /> : missing.length === 0 ? <span className="badge bg-emerald-100 text-emerald-800">ready</span> : <span className="badge bg-amber-100 text-amber-800">building</span>}</td>
                        <td className="text-slate-500">{missing.length ? missing.join(", ") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Compliance snapshot */}
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Compliance</h2>
          <ul className="space-y-3 text-sm">
            <ComplianceRow label="Waivers outstanding" value={waiversOutstanding} warn={waiversOutstanding > 0} />
            <ComplianceRow label="Background checks expired / expiring (30d)" value={bgChecksBad} warn={bgChecksBad > 0} />
            <ComplianceRow label="Facility agreements pending" value={stats.facilities.pending} warn={stats.facilities.pending > 0} />
          </ul>
          <Link href="/console/compliance" className="mt-4 inline-block text-sm font-medium text-brand-700">
            Compliance dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, hint, href, tone,
}: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "ok" | "warn" }) {
  const body = (
    <div className="stat-tile h-full transition-transform hover:-translate-y-0.5">
      <span className="pointer-events-none absolute -right-4 -top-4 h-14 w-14 rounded-xl bg-accent-500/15" />
      <div className="stat-k">{label}</div>
      <div className={`stat-v ${tone === "warn" ? "text-accent-400" : "text-white"}`}>{value}</div>
      {hint && <div className="stat-s">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

function BreakdownTable({ title, rows, unit }: { title: string; rows: BreakdownRow[]; unit: string }) {
  const totals = rows.reduce(
    (acc, r) => ({ active: acc.active + r.active, waitlist: acc.waitlist + r.waitlist, total: acc.total + r.total }),
    { active: 0, waitlist: 0, total: 0 },
  );
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        <span className="text-xs text-slate-400">{rows.length} {unit}{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 ? (
        <Empty text="No enrollments yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{title.replace("By ", "")}</th>
                <th className="px-3 text-right font-medium">Active</th>
                <th className="px-3 text-right font-medium">Waitlist</th>
                <th className="pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="py-1.5 pr-3 text-slate-700">{r.label}</td>
                  <td className="px-3 text-right tabular-nums text-slate-600">{r.active}</td>
                  <td className="px-3 text-right tabular-nums text-slate-600">{r.waitlist}</td>
                  <td className="pl-3 text-right font-semibold tabular-nums text-slate-900">{r.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 text-sm">
              <tr>
                <td className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-400">All</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{totals.active}</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{totals.waitlist}</td>
                <td className="pl-3 text-right font-semibold tabular-nums text-slate-900">{totals.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function ComplianceRow({ label, value, warn }: { label: string; value: number; warn: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={`badge ${warn ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{value}</span>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{text}</p>;
}
