import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { generateFacilityStatements, generatePayoutRun } from "./actions";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function PaymentsPage() {
  const now = new Date();
  const [inbound, outbound, payoutRuns, statements] = await Promise.all([
    prisma.payment.findMany({ where: { direction: "IN" }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({ where: { direction: "OUT" }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payoutRun.findMany({
      orderBy: { createdAt: "desc" }, take: 3,
      include: { lines: { include: { coach: { include: { person: true } } } } },
    }),
    prisma.facilityStatement.findMany({
      orderBy: { createdAt: "desc" }, take: 12, include: { facility: true },
    }),
  ]);

  const collected = inbound.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amountCents, 0);
  const requested = inbound.filter((p) => p.status === "REQUESTED" || p.status === "PENDING").reduce((s, p) => s + p.amountCents, 0);
  const paidOut = outbound.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Fees in, coaches and facilities out. Card data never touches our servers — Stripe hosted checkout." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Collected" value={formatCents(collected)} tone="emerald" />
        <Stat label="Requested / pending" value={formatCents(requested)} tone="amber" />
        <Stat label="Paid out" value={formatCents(paidOut)} tone="slate" />
      </div>

      {/* Coach payout register (§9) */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Coach payout register</h2>
            <p className="text-sm text-slate-500">Sessions delivered × flat rate (assistant 50%) plus à la carte earnings.</p>
          </div>
          <MonthForm action={generatePayoutRun} label="Generate payout run" now={now} />
        </div>
        {payoutRuns.length === 0 ? (
          <p className="text-sm text-slate-400">No payout runs yet.</p>
        ) : (
          <div className="space-y-4">
            {payoutRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">
                    {run.periodStart.toLocaleDateString()} – {new Date(run.periodEnd.getTime() - 1).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={run.status} />
                    <span className="font-semibold text-slate-800">
                      {formatCents(run.lines.reduce((s, l) => s + l.totalCents, 0))}
                    </span>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {run.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5 text-slate-700">{l.coach.person.firstName} {l.coach.person.lastName}</td>
                        <td className="text-slate-500">{l.sessionsDelivered} sessions</td>
                        <td className="text-slate-500">{formatCents(l.sessionPayCents)} + {formatCents(l.alaCarteCents)} à la carte</td>
                        <td className="px-3 text-right font-medium text-slate-800">{formatCents(l.totalCents)}</td>
                      </tr>
                    ))}
                    {run.lines.length === 0 && <tr><td className="px-3 py-2 text-slate-400" colSpan={4}>No delivered sessions in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Facility statements (§10) */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Monthly facility statements</h2>
            <p className="text-sm text-slate-500">Delivered sessions, on-site practice revenue, and payment due — a contractual obligation.</p>
          </div>
          <MonthForm action={generateFacilityStatements} label="Generate statements" now={now} />
        </div>
        {statements.length === 0 ? (
          <p className="text-sm text-slate-400">No statements generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr><th className="py-2">Facility</th><th>Period</th><th>Basis</th><th>Sessions</th><th>On-site rev.</th><th>Due</th><th>Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.map((st) => (
                  <tr key={st.id}>
                    <td className="py-2 font-medium text-slate-800">{st.facility.name}</td>
                    <td className="text-slate-500">{MONTHS[st.periodStart.getUTCMonth()]} {st.periodStart.getUTCFullYear()}</td>
                    <td className="text-slate-500">{st.facility.feeBasis.replace(/_/g, " ").toLowerCase()}</td>
                    <td className="text-slate-600">{st.sessionsDelivered}</td>
                    <td className="text-slate-600">{st.onSiteRevenueCents ? formatCents(st.onSiteRevenueCents) : "—"}</td>
                    <td className="font-medium text-slate-800">{formatCents(st.amountDueCents)}</td>
                    <td><StatusBadge status={st.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Ledger title="Fees in" rows={inbound} />
        <Ledger title="Payments out" rows={outbound} />
      </div>
    </div>
  );
}

function Ledger({ title, rows }: { title: string; rows: Array<{ id: string; amountCents: number; status: string; category: string; party: { firstName: string; lastName: string } | null }> }) {
  return (
    <div className="card">
      <h2 className="mb-3 font-semibold text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-slate-800">{formatCents(p.amountCents)}</div>
                <div className="text-xs text-slate-400">
                  {p.party ? `${p.party.firstName} ${p.party.lastName} · ` : ""}{p.category.replace(/_/g, " ")}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "emerald" | "amber" | "slate" }) {
  const c = { emerald: "text-emerald-600", amber: "text-amber-600", slate: "text-slate-900" }[tone];
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${c}`}>{value}</div>
    </div>
  );
}

function MonthForm({ action, label, now }: { action: (fd: FormData) => Promise<void>; label: string; now: Date }) {
  const y = now.getUTCFullYear();
  return (
    <form action={action} className="flex items-end gap-2">
      <div>
        <label className="sr-only">Month</label>
        <select name="month" defaultValue={now.getUTCMonth() + 1} className="input py-1.5 text-sm">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>
      <select name="year" defaultValue={y} className="input py-1.5 text-sm">
        {[y - 1, y, y + 1].map((yr) => <option key={yr} value={yr}>{yr}</option>)}
      </select>
      <button className="btn-secondary whitespace-nowrap text-sm">{label}</button>
    </form>
  );
}
