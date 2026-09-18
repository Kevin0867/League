import { PageHeader } from "@/components/RoadmapNote";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { pnlModel, monthTotals, monthLabel, thisMonth, revenueBetween, coachCostBetween, type PnlMonth, type PnlEntryRow } from "@/lib/domain/pnl";
import { phoenixDateInput } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "P&L" };

const RT = "/console/pnl";

export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const { months } = await pnlModel();

  const monthKeys = months.map((m) => m.month);
  const selectedKey = sp.month && monthKeys.includes(sp.month) ? sp.month : (monthKeys.includes(thisMonth()) ? thisMonth() : monthKeys[monthKeys.length - 1] ?? thisMonth());
  const selected: PnlMonth = months.find((m) => m.month === selectedKey) ?? { month: selectedKey, auto: { bookedCents: 0, forecastCents: 0, coachCostCents: 0 }, revenue: [], expenses: [] };
  const t = monthTotals(selected);
  const returnTo = `${RT}?month=${selectedKey}`;

  // Custom date range for pulling revenue over any window (not just a month).
  const today = phoenixDateInput(new Date());
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const rangeFrom = sp.from && dayRe.test(sp.from) ? sp.from : `${thisMonth()}-01`;
  const rangeTo = sp.to && dayRe.test(sp.to) ? sp.to : today;
  const rangeValid = rangeFrom <= rangeTo;
  const [rangeRev, rangeCoach] = rangeValid
    ? await Promise.all([revenueBetween(rangeFrom, rangeTo), coachCostBetween(rangeFrom, rangeTo)])
    : [{ bookedCents: 0, forecastCents: 0 }, 0];
  const rangeNet = rangeRev.bookedCents - rangeCoach;

  return (
    <div className="space-y-6">
      <PageHeader title="P&amp;L" subtitle="Track revenue and expenses by month. Booked revenue is cash actually collected — a subscription's paid installment counts now; the rest is forecast." />

      {sp.ok === "added" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Line item added.</div>}
      {sp.ok === "saved" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.ok === "deleted" && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">Line item removed.</div>}
      {sp.err === "fields" && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Give the line item a name (and pick a month).</div>}
      {sp.err && sp.err !== "fields" && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Something went wrong — please try again.</div>}

      {/* Custom date range — pull collected revenue for any window you choose. */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Revenue for a date range</h2>
        <p className="mt-0.5 text-sm text-slate-500">Choose any start and end date to see exactly what was collected (booked) in that window — a subscription installment counts on the day it cleared.</p>
        <form method="GET" action={RT} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="month" value={selectedKey} />
          <div>
            <label className="label text-xs">From</label>
            <input name="from" type="date" defaultValue={rangeFrom} className="input py-1.5 text-sm" />
          </div>
          <div>
            <label className="label text-xs">To</label>
            <input name="to" type="date" defaultValue={rangeTo} className="input py-1.5 text-sm" />
          </div>
          <button className="btn-primary text-sm">Pull revenue</button>
        </form>
        {!rangeValid ? (
          <p className="mt-3 text-sm text-rose-700">The “from” date needs to be on or before the “to” date.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <Stat label="Booked revenue" value={formatCents(rangeRev.bookedCents)} tone="emerald" sub={`${rangeFrom} → ${rangeTo}`} />
            <Stat label="Forecast revenue" value={formatCents(rangeRev.forecastCents)} sub="scheduled / outstanding in range" />
            <Stat label="Coach session pay" value={formatCents(rangeCoach)} tone="rose" sub="delivered practices in range" />
            <Stat label="Net (booked − coach)" value={formatCents(rangeNet)} tone={rangeNet >= 0 ? "emerald" : "rose"} sub="add your expenses below" />
          </div>
        )}
      </div>

      {/* Month picker */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-600">Month:</span>
        <form method="GET" action={RT} className="flex items-center gap-2">
          <select name="month" defaultValue={selectedKey} className="input py-1.5 text-sm">
            {monthKeys.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
          </select>
          <button className="btn-secondary text-sm">Show</button>
        </form>
      </div>

      {/* Selected month summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Booked revenue" value={formatCents(t.bookedRevenue)} tone="emerald" sub="collected this month" />
        <Stat label="Forecast revenue" value={formatCents(t.forecastRevenue)} sub="scheduled / outstanding" />
        <Stat label="Expenses" value={formatCents(t.actualExpenses)} tone="rose" sub={t.projectedExpenses !== t.actualExpenses ? `${formatCents(t.projectedExpenses)} with forecast` : undefined} />
        <Stat label="Net (booked)" value={formatCents(t.netBooked)} tone={t.netBooked >= 0 ? "emerald" : "rose"} sub={`${formatCents(t.netProjected)} projected`} />
      </div>

      {/* Revenue */}
      <Section
        title="Revenue"
        month={selectedKey}
        section="REVENUE"
        ticket={ticket}
        returnTo={returnTo}
        autoRows={[
          { label: "Booked revenue (collected)", value: selected.auto.bookedCents, note: "Cash actually collected this month — live from Stripe (net of refunds, includes apparel) + offline payments. Matches Payments. Auto." },
          ...(selected.auto.forecastCents > 0 ? [{ label: "Scheduled / outstanding (forecast)", value: selected.auto.forecastCents, note: "Installments due later + unpaid one-time fees, expected this month. Auto." }] : []),
        ]}
        rows={selected.revenue}
      />

      {/* Expenses */}
      <Section
        title="Expenses"
        month={selectedKey}
        section="EXPENSE"
        ticket={ticket}
        returnTo={returnTo}
        autoRows={selected.auto.coachCostCents > 0 ? [{ label: "Coach session pay (delivered)", value: selected.auto.coachCostCents, note: "Delivered practices × the per-session rate. Auto." }] : []}
        rows={selected.expenses}
      />

      {/* Program projection — every month, totals only */}
      <div className="card overflow-x-auto">
        <h2 className="mb-1 font-semibold text-slate-900">Program projection — all months</h2>
        <p className="mb-3 text-sm text-slate-500">Booked is collected cash; projected adds forecast (scheduled installments + your forecast rows).</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Month</th>
              <th className="text-right">Booked rev.</th>
              <th className="text-right">Forecast rev.</th>
              <th className="text-right">Expenses</th>
              <th className="text-right">Net (booked)</th>
              <th className="text-right">Net (projected)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {months.map((m) => {
              const mt = monthTotals(m);
              const isSel = m.month === selectedKey;
              return (
                <tr key={m.month} className={isSel ? "bg-brand-50/50" : ""}>
                  <td className="py-2 font-medium text-slate-800">
                    <a href={`${RT}?month=${m.month}`} className="hover:text-brand-700 hover:underline">{monthLabel(m.month)}</a>
                  </td>
                  <td className="text-right text-emerald-700">{formatCents(mt.bookedRevenue)}</td>
                  <td className="text-right text-slate-500">{formatCents(mt.forecastRevenue)}</td>
                  <td className="text-right text-rose-700">{formatCents(mt.projectedExpenses)}</td>
                  <td className={`text-right font-medium ${mt.netBooked >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(mt.netBooked)}</td>
                  <td className={`text-right font-semibold ${mt.netProjected >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(mt.netProjected)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(() => {
              const tot = months.reduce((a, m) => {
                const mt = monthTotals(m);
                a.booked += mt.bookedRevenue; a.forecast += mt.forecastRevenue; a.exp += mt.projectedExpenses; a.netB += mt.netBooked; a.netP += mt.netProjected;
                return a;
              }, { booked: 0, forecast: 0, exp: 0, netB: 0, netP: 0 });
              return (
                <tr className="border-t-2 border-slate-200 font-bold">
                  <td className="py-2">Program total</td>
                  <td className="text-right text-emerald-700">{formatCents(tot.booked)}</td>
                  <td className="text-right text-slate-600">{formatCents(tot.forecast)}</td>
                  <td className="text-right text-rose-700">{formatCents(tot.exp)}</td>
                  <td className={`text-right ${tot.netB >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(tot.netB)}</td>
                  <td className={`text-right ${tot.netP >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(tot.netP)}</td>
                </tr>
              );
            })()}
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Booked revenue and coach session pay are computed live from real payments and delivered practices — edit those upstream (Payments / Schedule).
        Everything else here is yours to add and edit: rent, courts, marketing, supplies, extra revenue, and forecast rows for projecting ahead.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "emerald" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Section({
  title, month, section, ticket, returnTo, autoRows, rows,
}: {
  title: string; month: string; section: "REVENUE" | "EXPENSE"; ticket: string; returnTo: string;
  autoRows: { label: string; value: number; note?: string }[]; rows: PnlEntryRow[];
}) {
  const manualTotal = rows.reduce((s, r) => s + r.amountCents, 0);
  const autoTotal = autoRows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <span className="text-sm font-semibold text-slate-700">{formatCents(autoTotal + manualTotal)}</span>
      </div>

      {/* Auto (read-only) rows */}
      {autoRows.map((a) => (
        <div key={a.label} className="flex items-start justify-between gap-3 border-b border-slate-100 py-2">
          <div>
            <div className="text-sm font-medium text-slate-700">{a.label} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">auto</span></div>
            {a.note && <div className="text-[11px] text-slate-400">{a.note}</div>}
          </div>
          <div className="whitespace-nowrap text-sm font-semibold text-slate-800">{formatCents(a.value)}</div>
        </div>
      ))}

      {/* Editable manual rows */}
      {rows.map((r) => (
        <form key={r.id} method="POST" action="/api/console/pnl" className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input name="label" defaultValue={r.label} className="input min-w-[8rem] flex-1 py-1 text-sm" />
          <select name="kind" defaultValue={r.kind} className="input w-28 py-1 text-sm">
            <option value="ACTUAL">Actual</option>
            <option value="FORECAST">Forecast</option>
          </select>
          <div className="flex items-center gap-1">
            <span className="text-slate-400">$</span>
            <input name="amount" type="text" inputMode="decimal" defaultValue={(r.amountCents / 100).toFixed(2)} className="input w-24 py-1 text-right text-sm" />
          </div>
          {/* Each button carries its own op, so exactly one op is submitted. */}
          <button name="op" value="update" className="btn-chip-brand">Save</button>
          <button name="op" value="delete" className="btn-chip-danger" formNoValidate>Delete</button>
        </form>
      ))}

      {/* Add row */}
      <form method="POST" action="/api/console/pnl" className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="add" />
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="min-w-[9rem] flex-1">
          <label className="label text-xs">Add {title.toLowerCase()} line</label>
          <input name="label" required placeholder={section === "EXPENSE" ? "e.g. Court rental" : "e.g. Clinic revenue"} className="input py-1 text-sm" />
        </div>
        <select name="kind" defaultValue="ACTUAL" className="input w-28 py-1 text-sm">
          <option value="ACTUAL">Actual</option>
          <option value="FORECAST">Forecast</option>
        </select>
        <div>
          <label className="label text-xs">Amount</label>
          <div className="flex items-center gap-1">
            <span className="text-slate-400">$</span>
            <input name="amount" type="text" inputMode="decimal" placeholder="0.00" className="input w-24 py-1 text-right text-sm" />
          </div>
        </div>
        <button className="btn-primary text-sm">Add</button>
      </form>
    </div>
  );
}
