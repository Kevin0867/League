import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { FeeReminderList } from "./FeeReminderList";
import { PrintButton } from "@/components/PrintButton";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { mintConsoleTicket } from "@/lib/auth";
import { CustomPaymentForm } from "@/components/CustomPaymentForm";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { personContacts } from "@/lib/domain/contacts";
import { requireAdmin } from "@/lib/rbac";
import { getStripeWebhookStatus } from "@/lib/payments/webhookStatus";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const now = new Date();
  // The ledgers below show the 50 most recent rows, but every headline figure and
  // the outstanding/failed lists are computed from ALL payments so the numbers are
  // accurate no matter how many payments exist.
  const [inbound, outbound, payoutRuns, statements, failed, outstanding, collectedAgg, paidOutAgg] = await Promise.all([
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
    prisma.payment.findMany({ where: { direction: "IN", status: { in: ["REQUESTED", "PENDING"] } }, include: { party: { include: { guardian: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.payment.aggregate({ where: { direction: "IN", status: "PAID" }, _sum: { amountCents: true } }),
    prisma.payment.aggregate({ where: { direction: "OUT", status: "PAID" }, _sum: { amountCents: true } }),
  ]);

  const collected = collectedAgg._sum.amountCents ?? 0;
  const requested = outstanding.reduce((s, p) => s + p.amountCents, 0);
  const paidOut = paidOutAgg._sum.amountCents ?? 0;

  // Webhook health — the usual reason paid charges don't get recorded here.
  const wh = await getStripeWebhookStatus();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Payments" subtitle="Fees in, coaches and facilities out. Card data never touches our servers — Stripe hosted checkout." />
        <div className="flex items-center gap-2">
          <form method="POST" action="/api/console/payments-reconcile">
            <input type="hidden" name="ticket" value={ticket} />
            <button className="btn-secondary text-sm" title="Check Stripe for any payment that was completed there but not yet recorded here, and record it.">
              Reconcile with Stripe
            </button>
          </form>
          <PrintButton label="Print" />
        </div>
      </div>

      {sp.recok && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Reconciled {sp.scanned ?? "0"} Stripe payment{sp.scanned === "1" ? "" : "s"}.{" "}
          {Number(sp.paid ?? 0) > 0
            ? <><strong>{sp.paid} newly recorded as paid</strong> — {formatCents(Number(sp.cents ?? 0))} added to Collected.</>
            : "No new payments to record."}
          {Number(sp.refunds ?? 0) > 0 ? <> {" "}<strong>{sp.refunds} refund{sp.refunds === "1" ? "" : "s"} recorded</strong> ({formatCents(Number(sp.refcents ?? 0))}).</> : ""}
          {Number(sp.paid ?? 0) === 0 && Number(sp.refunds ?? 0) === 0 ? " Everything already matched Stripe." : ""}
          {sp.recerrs && sp.recerrs !== "0" ? ` (${sp.recerrs} couldn't be checked — try again.)` : ""}
        </div>
      )}
      {sp.recerr === "notconfigured" && (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Stripe isn&apos;t connected, so there&apos;s nothing to reconcile against.
        </div>
      )}
      {sp.recerr && sp.recerr !== "notconfigured" && (
        <div className="rounded-lg border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Couldn&apos;t reconcile: {sp.recerr}
        </div>
      )}

      {/* Webhook health — a broken webhook is the usual reason paid charges don't
          get recorded, so surface it right where the money is, with direct
          Stripe links (mode-aware: live vs test). */}
      {wh.stripeConfigured && (() => {
        const hereEp = wh.endpoints.find((e) => e.pointsHere);
        const A = ({ href, children }: { href: string; children: string }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium underline">{children}</a>
        );
        return wh.matchingHealthy && wh.webhookSecretSet ? (
          <details className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <summary className="cursor-pointer font-medium">✓ Payment webhook connected{wh.liveMode ? "" : " (test mode)"}</summary>
            <p className="mt-2 text-emerald-700">
              Stripe notifies <span className="font-mono text-xs">{wh.expectedUrl}</span> on payment completion and the signing
              secret is set — new payments should record automatically. If one is ever missed, use &ldquo;Reconcile with
              Stripe&rdquo; above. {hereEp && <>View this endpoint&apos;s deliveries: <A href={hereEp.dashboardUrl}>open in Stripe ↗</A>.</>}
            </p>
          </details>
        ) : (
          <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">⚠ Payment webhook needs attention — this is why paid charges may not be recording.{wh.liveMode ? "" : " (Stripe is in TEST mode.)"}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {!wh.webhookSecretSet && (
                <li><strong>Signing secret not set.</strong> Open <A href={hereEp ? hereEp.dashboardUrl : wh.webhooksUrl}>your webhook endpoint in Stripe ↗</A>, click <em>Reveal</em> under &ldquo;Signing secret,&rdquo; and set it as <span className="font-mono text-xs">STRIPE_WEBHOOK_SECRET</span> in <A href="https://vercel.com/dashboard">Vercel ↗</A>, then redeploy.</li>
              )}
              {wh.listed && !wh.endpoints.some((e) => e.pointsHere) && wh.endpoints.filter((e) => e.samePathOtherHost).map((e) => (
                <li key={`host${e.id}`}><strong>A webhook points at a different domain.</strong> It targets <span className="font-mono text-xs">{e.url}</span>, but this site expects <span className="font-mono text-xs">{wh.expectedUrl}</span>. If that domain is a <em>different deployment or database</em>, your payments are being recorded there, not here. <A href={e.dashboardUrl}>Open the endpoint ↗</A> and set its URL to <span className="font-mono text-xs">{wh.expectedUrl}</span> (or confirm both domains serve the same project).</li>
              ))}
              {wh.listed && !wh.endpoints.some((e) => e.pointsHere) && !wh.endpoints.some((e) => e.samePathOtherHost) && (
                <li><strong>No Stripe webhook points here.</strong> <A href={wh.createUrl}>Add an endpoint in Stripe ↗</A> with URL <span className="font-mono text-xs">{wh.expectedUrl}</span> and event <span className="font-mono text-xs">checkout.session.completed</span>.</li>
              )}
              {wh.endpoints.filter((e) => e.pointsHere && e.status !== "enabled").map((e) => (
                <li key={`dis${e.id}`}><strong>The endpoint here is {e.status}.</strong> <A href={e.dashboardUrl}>Enable it in Stripe ↗</A>.</li>
              ))}
              {wh.endpoints.filter((e) => e.pointsHere && e.status === "enabled" && !e.coversRequired).map((e) => (
                <li key={`ev${e.id}`}><strong>Missing the completion event.</strong> <A href={e.dashboardUrl}>Open the endpoint ↗</A> and subscribe it to <span className="font-mono text-xs">checkout.session.completed</span>{e.missingHelpful.length ? ` (also recommended: ${e.missingHelpful.filter((x) => x !== "checkout.session.completed").join(", ")})` : ""}.</li>
              ))}
              {!wh.listed && (
                <li>Couldn&apos;t read your webhooks from Stripe{wh.listError ? ` (${wh.listError})` : ""} — check <A href={wh.webhooksUrl}>Stripe → Webhooks ↗</A>. Expected URL: <span className="font-mono text-xs">{wh.expectedUrl}</span>.</li>
              )}
            </ul>
            <p className="mt-2 text-amber-800">
              Reference: <A href={wh.webhooksUrl}>Webhooks ↗</A> · <A href={wh.apiKeysUrl}>API keys ↗</A>.
              Meanwhile, &ldquo;Reconcile with Stripe&rdquo; above pulls in any charges that were missed.
            </p>
          </div>
        );
      })()}

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
        <ReminderResult n={sp.n} failed={sp.failed} sim={sp.sim} skipped={sp.skipped} reason={sp.reason} />
      )}
      {sp.ok === "testsent" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Preview sent — check your inbox for the sample fee-request email.
        </div>
      )}
      {sp.ok === "testsim" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Preview was <strong>simulated</strong> — the email provider isn&apos;t configured, so nothing was actually delivered. Set <code>RESEND_API_KEY</code> to send real email.
        </div>
      )}
      {sp.err === "sendfail" && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-medium">The preview didn&apos;t send.</p>
          {sp.reason && <p className="mt-1 font-mono text-xs text-rose-700">{sp.reason}</p>}
          <p className="mt-1">Fix the issue above, then click &ldquo;Send me a preview&rdquo; again.</p>
        </div>
      )}
      {sp.err === "noemail" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">No email on your account to send the preview to.</div>
      )}
      {sp.err === "cpname" && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Enter the recipient&apos;s name.</div>}
      {sp.err === "cpemail" && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Enter a valid recipient email.</div>}
      {sp.err === "cpamount" && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Enter an amount greater than $0.50.</div>}
      {sp.ok === "requested" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">Payment request created.</p>
          <p className="mt-1">
            {sp.cpunsent
              ? "Email delivery didn't complete — copy the pay link and send it directly:"
              : "We emailed the recipient a secure pay link. You can also copy it:"}
          </p>
          {sp.pid && (
            <div className="mt-2"><CopyLinkButton path={`/pay/${sp.pid}`} label="Copy pay link" /></div>
          )}
        </div>
      )}

      {/* Request a custom card payment (any amount + optional discount) */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Request a payment</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Charge any amount to a recipient by card — for ACP entries ($195, $125…) or any one-off. Add a discount
          if you like; we email them a secure Stripe pay link.
        </p>
        <CustomPaymentForm ticket={ticket} />
      </div>

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

      {/* Fee reminders — pick exactly who gets a reminder before sending */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Fee reminders</h2>
            <p className="text-sm text-slate-500">
              {outstanding.length > 0
                ? `${outstanding.length} unpaid request${outstanding.length === 1 ? "" : "s"} (${formatCents(requested)}). Choose who to remind — these are real emails.`
                : "No outstanding fee requests right now."}
            </p>
          </div>
          <form method="POST" action="/api/console/registrations">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="sendTestPayment" />
            <button className="btn-ghost text-sm">Send me a preview</button>
          </form>
        </div>
        {outstanding.length > 0 && (
          <FeeReminderList
            ticket={ticket}
            recipients={outstanding.map((p) => ({
              id: p.id,
              name: p.party ? `${p.party.firstName} ${p.party.lastName}` : "Unknown payer",
              amount: formatCents(p.amountCents),
              description: (p.description ?? p.category.replace(/_/g, " ")) + (p.status === "PENDING" ? " · in checkout" : ""),
              contacts: p.party
                ? personContacts(p.party, p.party.isMinor ? p.party.guardian : null).map((c) => ({ email: c.email, name: c.name, source: c.source }))
                : [],
            }))}
          />
        )}
      </div>

      {/* Coach payout register (§9) */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Coach payout register</h2>
            <p className="text-sm text-slate-500">Sessions delivered × flat rate (assistant 50%) plus private-lesson earnings.</p>
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
                        <td className="px-3 py-1.5 text-slate-700"><Link href={`/console/coaches/${l.coach.person.id}`} className="hover:text-brand-700 hover:underline">{l.coach.person.firstName} {l.coach.person.lastName}</Link></td>
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

// Outcome banner for a bulk fee-reminder run. Green when everything went out,
// but escalates to amber/rose the moment anything failed, was only simulated, or
// was skipped — with the first error reason spelled out so staff can correct it
// and re-select those recipients to resend.
function ReminderResult({
  n, failed, sim, skipped, reason,
}: { n?: string; failed?: string; sim?: string; skipped?: string; reason?: string }) {
  const sent = Number(n ?? 0);
  const nFailed = Number(failed ?? 0);
  const nSim = Number(sim ?? 0);
  const nSkipped = Number(skipped ?? 0);
  const problem = nFailed > 0 || nSim > 0 || nSkipped > 0;
  const tone = nFailed > 0 || nSkipped > 0
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : nSim > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <p className="font-medium">
        {sent > 0 ? `Sent ${sent} reminder${sent === 1 ? "" : "s"}.` : "No reminders were delivered."}
        {nFailed > 0 && ` ${nFailed} failed.`}
        {nSim > 0 && ` ${nSim} simulated (not actually delivered).`}
        {nSkipped > 0 && ` ${nSkipped} skipped.`}
      </p>
      {reason && <p className="mt-1 font-mono text-xs opacity-80">First issue — {reason}</p>}
      {problem && (
        <p className="mt-1">
          Correct the issue, then re-select those recipients below and send again. Every send is logged in{" "}
          <Link href="/console/messages" className="underline">Messages</Link>.
        </p>
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
