import Link from "next/link";
import { prisma } from "@/lib/db";
import { teamMissingFields } from "@/lib/domain/teams";
import { StatusBadge } from "@/components/StatusBadge";

export default async function ConsoleDashboard() {
  const [
    regCount,
    assignedCount,
    waitlistCount,
    teams,
    facilities,
    waiversOutstanding,
    coaches,
    activeSeason,
    sessionCount,
  ] = await Promise.all([
    prisma.registration.count(),
    prisma.registration.count({ where: { status: "ASSIGNED" } }),
    prisma.registration.count({ where: { status: "WAITLISTED" } }),
    prisma.team.findMany({ include: { _count: { select: { members: true } }, facility: true } }),
    prisma.facility.findMany({ where: { archived: false } }),
    prisma.person.count({ where: { waiverSignedAt: null, registrations: { some: {} } } }),
    prisma.coach.findMany(),
    prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, include: { _count: { select: { divisions: true } } } }),
    prisma.session.count(),
  ]);

  const completeTeams = teams.filter((t) => teamMissingFields(t).length === 0).length;
  const publishedTeams = teams.filter((t) => t.published).length;
  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED").length;
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const bgChecksExpiring = coaches.filter(
    (c) => c.backgroundCheckExpiry && c.backgroundCheckExpiry < soon
  ).length;

  // Whole-season getting-started sequence. Each step links to where it's done;
  // the first unfinished step is highlighted as "you are here".
  const setup = [
    { done: !!activeSeason, label: "Create & activate your season", href: "/console/setup", hint: "Season Setup" },
    { done: (activeSeason?._count.divisions ?? 0) > 0, label: "Add divisions (skill bands / levels)", href: "/console/setup", hint: "Season Setup" },
    { done: regCount > 0, label: "Bring in registrations — import or add players", href: "/console/registrations", hint: "Registrations" },
    { done: coaches.length > 0, label: "Add your coaches", href: "/console/coaches", hint: "Coaches" },
    { done: executed > 0, label: "Add facilities & execute agreements", href: "/console/facilities", hint: "Facilities" },
    { done: assignedCount > 0, label: "Assign players into teams", href: "/console/board", hint: "Boards" },
    { done: completeTeams > 0, label: "Complete each team's six fields", href: "/console/teams", hint: "Team Build" },
    { done: sessionCount > 0, label: "Generate the practice schedule", href: "/console/schedule", hint: "Schedule" },
    { done: publishedTeams > 0, label: "Publish teams to families", href: "/console/teams", hint: "Team Build" },
  ];
  const doneCount = setup.filter((s) => s.done).length;
  const nextIdx = setup.findIndex((s) => !s.done);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Season dashboard</h1>
        <p className="text-slate-500">A live read on the build toward Week 1.</p>
      </div>

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
        <Stat label="Facilities executed" value={`${executed}/${facilities.length}`} href="/console/facilities" hint="agreements signed" tone={executed === 0 ? "warn" : "ok"} />
        <Stat label="Waivers outstanding" value={waiversOutstanding} href="/console/compliance" hint="no court-ready roster without one" tone={waiversOutstanding > 0 ? "warn" : "ok"} />
      </div>

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
            <ComplianceRow label="Background checks expiring (30d)" value={bgChecksExpiring} warn={bgChecksExpiring > 0} />
            <ComplianceRow label="Facility agreements pending" value={facilities.length - executed} warn={facilities.length - executed > 0} />
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
