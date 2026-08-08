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
  ] = await Promise.all([
    prisma.registration.count(),
    prisma.registration.count({ where: { status: "ASSIGNED" } }),
    prisma.registration.count({ where: { status: "WAITLISTED" } }),
    prisma.team.findMany({ include: { _count: { select: { members: true } }, facility: true } }),
    prisma.facility.findMany(),
    prisma.person.count({ where: { waiverSignedAt: null, registrations: { some: {} } } }),
    prisma.coach.findMany(),
  ]);

  const completeTeams = teams.filter((t) => teamMissingFields(t).length === 0).length;
  const publishedTeams = teams.filter((t) => t.published).length;
  const executed = facilities.filter((f) => f.agreementStatus === "EXECUTED").length;
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const bgChecksExpiring = coaches.filter(
    (c) => c.backgroundCheckExpiry && c.backgroundCheckExpiry < soon
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Season dashboard</h1>
        <p className="text-slate-500">A live read on the build toward Week 1.</p>
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
    <div className="card h-full">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
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
