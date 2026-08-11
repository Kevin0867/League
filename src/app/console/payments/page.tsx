import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { mintConsoleTicket } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const now = new Date();
  const [inbound, outbound, payoutRuns, statements, failed] = await Promise.all([
    prisma.payment.findMany({ where: { direction: "IN" }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({ where: { direction: "OUT" }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payoutRun.findMany({
      orderBy: { createdAt: "desc" }, take: 3,
      include: { lines: { include: { coach: { include: { person: true } } } } },
    }),
    prisma.facilityStatement.findMany({
      orderBy: { createdAt: "desc" }, take: 12, include: { facility: true },
    }),
    prisma.payment.findMany({ where: { direction: "IN", status: "FAILED" }, include: { party: true }, orderBy: { updatedAt: "desc" } }),
  ]);

  const outstanding = inbound.filter((p) => p.status === "REQUESTED" || p.status === "PENDING");
  const collected = inbound.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amountCents, 0);
  const requested = outstanding.reduce((s, p) => s + p.amountCents, 0);
  const paidOut = outbound.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Fees in, coaches and facilities out. Card data never touches our servers — Stripe hosted checkout." />

      {sp.ok === "statements" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Facility statements generated.</div>
      )}
      {sp.ok === "payouts" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Coach payout run generated.</div>
      )}
      {sp.err === "auth" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Not authorized to run payouts.</div>
      )}
      {sp.ok === "resentAll" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Resent {sp.n ?? 0} outstanding fee request{sp.n === "1" ? "" : "s"}.
        </div>
      )}
      {sp.ok === "testsent" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Preview sent — check your inbox for the sample fee-request email.
        </div>
      )}
      {sp.err === "noemail" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">No email on your account to send the preview to.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Collected" value={formatCents(collected)} tone="emerald" />
        <Stat label="Requested / pending" value={formatCents(requested)} tone="amber" />
        <Stat label="Paid out" value={formatCents(paidOut)} tone="slate" />
      </div>

      {failed.length > 0 && (
        <div className="card border-l-4 border-rose-500 bg-rose-50/40">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <h2 className="font-semibold text-rose-800">
              {failed.length} unsuccessful payment{failed.length === 1 ? "" : "s"}
            </h2>
          </div>
          <p className="mt-1 text-sm text-rose-700/80">
            A charge was declined or failed. Follow up with the payer to collect the balance.
          </p>
          <ul className="mt-3 divide-y divide-rose-100 text-sm">
            {failed.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  {p.party ? (
                    <Link href={`/console/people/${p.partyId}`} className="font-medium text-rose-900 hover:underline">
                      {p.party.firstName} {p.party.lastName}
                    </Link>
                  ) : (
                    <span className="font-medium text-rose-900">Unknown payer</span>
                  )}
                  <span className="ml-2 text-xs text-rose-700/70">
                    {p.category.replace(/_/g, " ").toLowerCase()}
                    {p.installmentPlan ? ` · installment ${Math.min(p.installmentsPaid + 1, p.installmentsTotal ?? 3)}/${p.installmentsTotal ?? 3}` : ""}
                  </span>
                </div>
                <span className="font-semibold text-rose-900">{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fee reminders — bulk resend + preview */}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Fee reminders</h2>
          <p className="text-sm text-slate-500">
            {outstanding.length > 0
              ? `${outstanding.length} player${outstanding.length === 1 ? "" : "s"} with an unpaid request (${formatCents(requested)}).`
              : "No outstanding fee requests right now."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form method="POST" action="/api/console/registrations">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="sendTestPayment" />
            <button className="btn-ghost text-sm">Send me a preview</button>
          </form>
          <ConfirmSubmit
            action="/api/console/registrations"
            fields={{ ticket, op: "resendAllFees" }}
            confirm={`Email the fee request to ${outstanding.length} ${outstanding.length === 1 ? "person" : "people"} with an unpaid balance?`}
            label={`Resend all (${outstanding.length})`}
            className="btn-secondary text-sm"
            disabled={outstanding.length === 0}
          />
        </div>
      </div>

      {/* Coach payout register (§9) */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Coach payout register</h2>
            <p className="text-sm text-slate-500">Sessions delivered × flat rate (assistant 50%) plus à la carte earnings.</p>
          </div>
          <MonthForm op="payouts" ticket={ticket} label="Generate payout run" now={now} />
        </div>
        {payoutRuns.length === 0 ? (
          <p className="text-sm text-slate-400">No payout runs yet.</p>
        ) : (
          <div className="space-y-4">
            {payoutRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">
                    {formatDate(run.periodStart)} – {formatDate(new Date(run.periodEnd.getTime() - 1))}
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
          <MonthForm op="statements" ticket={ticket} label="Generate statements" now={now} />
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

function MonthForm({ op, ticket, label, now }: { op: string; ticket: string; label: string; now: Date }) {
  const y = now.getUTCFullYear();
  return (
    <form method="POST" action="/api/console/payments" className="flex items-end gap-2">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={op} />
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
