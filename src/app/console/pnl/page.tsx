import { PageHeader } from "@/components/RoadmapNote";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { pnlRange, monthLabel, today, type PnlRange, type PnlEntryRow, type CourtCost } from "@/lib/domain/pnl";
import { paymentsSince } from "@/lib/payments/reconcile";
import { phoenixDateInput } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "P&L" };

const RT = "/console/pnl";
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  // Default range = since we started collecting (matches the Payments total) → today.
  const startDefault = phoenixDateInput(paymentsSince().date);
  const from = sp.from && dayRe.test(sp.from) ? sp.from : startDefault;
  const to = sp.to && dayRe.test(sp.to) ? sp.to : today();
  const valid = from <= to;

  const pnl: PnlRange = valid
    ? await pnlRange(from, to)
    : { fromDay: from, toDay: to, months: [from.slice(0, 7)], auto: { bookedCents: 0, forecastCents: 0, forecastPlayers: 0, coachCostCents: 0, courtCosts: [] }, revenue: [], expenses: [], totals: { bookedRevenue: 0, forecastRevenue: 0, projectedRevenue: 0, actualExpenses: 0, projectedExpenses: 0, netBooked: 0, netProjected: 0 } };
  const t = pnl.totals;
  const returnTo = `${RT}?from=${from}&to=${to}`;
  const addMonth = pnl.months[pnl.months.length - 1] ?? to.slice(0, 7);

  return (
    <div className="space-y-6">
      <PageHeader title="P&amp;L" subtitle="Choose a date range. Booked revenue is cash actually collected in that window — it matches the Payments “Collected” figure. Add and edit any expense or revenue line." />

      {sp.ok === "added" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Line item added.</div>}
      {sp.ok === "saved" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.ok === "deleted" && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">Line item removed.</div>}
      {sp.ok === "courtpulled" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Court rent pulled into editable line items{sp.n ? ` (${sp.n})` : ""} — edit any amount below.</div>}
      {sp.err === "fields" && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Give the line item a name, amount, and month.</div>}
      {sp.err && !["fields"].includes(sp.err) && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Something went wrong — please try again.</div>}

      {/* Date range — the single control that drives the whole P&L. */}
      <div className="card">
        <form method="GET" action={RT} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label text-xs">From</label>
            <input name="from" type="date" defaultValue={from} className="input py-1.5 text-sm" />
          </div>
          <div>
            <label className="label text-xs">To</label>
            <input name="to" type="date" defaultValue={to} className="input py-1.5 text-sm" />
          </div>
          <button className="btn-primary text-sm">Update</button>
          <span className="ml-1 text-xs text-slate-400">Tip: set From to when you started collecting and To to today to match Payments. Extend To into the future to project ahead.</span>
        </form>
        {!valid && <p className="mt-3 text-sm text-rose-700">The “from” date needs to be on or before the “to” date.</p>}
      </div>

      {/* Summary for the range */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Booked revenue" value={formatCents(t.bookedRevenue)} tone="emerald" sub="collected in range" />
        <Stat label="Forecast revenue" value={formatCents(t.forecastRevenue)} sub="scheduled / outstanding" />
        <Stat label="Expenses" value={formatCents(t.actualExpenses)} tone="rose" sub={t.projectedExpenses !== t.actualExpenses ? `${formatCents(t.projectedExpenses)} with forecast` : undefined} />
        <Stat label="Net (booked)" value={formatCents(t.netBooked)} tone={t.netBooked >= 0 ? "emerald" : "rose"} sub={`${formatCents(t.netProjected)} projected`} />
      </div>

      {/* Revenue */}
      <Section
        title="Revenue"
        section="REVENUE"
        ticket={ticket}
        returnTo={returnTo}
        months={pnl.months}
        addMonth={addMonth}
        autoRows={[
          { label: "Booked revenue (collected)", value: pnl.auto.bookedCents, note: "Cash actually collected in this range — live from Stripe (net of refunds, includes apparel) + offline payments. Matches Payments. Auto." },
          ...(pnl.auto.forecastCents > 0 ? [{ label: `Scheduled / outstanding (forecast) · ${pnl.auto.forecastPlayers} player${pnl.auto.forecastPlayers === 1 ? "" : "s"}`, value: pnl.auto.forecastCents, note: "Installments due later + unpaid one-time fees expected in this range. Auto." }] : []),
        ]}
        rows={pnl.revenue}
      />

      {/* Expenses */}
      <Section
        title="Expenses"
        section="EXPENSE"
        ticket={ticket}
        returnTo={returnTo}
        months={pnl.months}
        addMonth={addMonth}
        autoRows={[
          ...(pnl.auto.coachCostCents > 0 ? [{ label: "Coach session pay (delivered)", value: pnl.auto.coachCostCents, note: "What coaches are owed for practices delivered in this range — per-coach rate, role-aware. Matches Payouts. Auto." }] : []),
        ]}
        rows={pnl.expenses}
        beforeAdd={
          pnl.auto.courtCosts.length > 0 ? (
            <CourtRentPull ticket={ticket} returnTo={returnTo} from={from} to={to} courtCosts={pnl.auto.courtCosts} />
          ) : null
        }
      />

      {/* Net */}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Net for {from} → {to}</h2>
          <p className="mt-0.5 text-sm text-slate-500">Booked revenue minus actual expenses. Projected adds forecast revenue and forecast expenses.</p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-extrabold ${t.netBooked >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(t.netBooked)}</div>
          <div className="text-xs text-slate-400">{formatCents(t.netProjected)} projected (with forecast)</div>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Booked revenue and coach session pay are computed live from real payments and delivered practices. Everything else is yours to edit —
        add rent, courts, marketing, supplies, extra revenue, and forecast rows. Line items are tagged to a month; the range includes every
        line item in the months it covers.
      </p>
    </div>
  );
}

// Court rent computed from facility rates — a preview + a button to pull it into
// editable line items (one Court-rent expense per facility, per month in range).
function CourtRentPull({ ticket, returnTo, from, to, courtCosts }: { ticket: string; returnTo: string; from: string; to: string; courtCosts: CourtCost[] }) {
  const total = courtCosts.reduce((s, c) => s + c.cents, 0);
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-amber-900">Court rent from facility rates <span className="font-normal text-amber-700">(computed)</span></div>
          <div className="mt-0.5 text-[11px] text-amber-700">Delivered practices × courts × hours × each facility&apos;s day / evening / weekend rate. Pull it in to get an editable line item per court that you can adjust.</div>
        </div>
        <div className="text-sm font-semibold text-amber-900">{formatCents(total)}</div>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
        {courtCosts.map((c) => (
          <li key={c.facilityName} className="flex justify-between"><span>Court rent — {c.facilityName}</span><span className="font-medium text-slate-700">{formatCents(c.cents)}</span></li>
        ))}
      </ul>
      <form method="POST" action="/api/console/pnl" className="mt-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="pullCourtCosts" />
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button className="btn-secondary text-sm">Pull into editable line items ↓</button>
        <span className="ml-2 text-[11px] text-slate-500">Creates/refreshes a Court rent line per facility for each month in range. Re-pull to recompute.</span>
      </form>
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
  title, section, ticket, returnTo, months, addMonth, autoRows, rows, beforeAdd,
}: {
  title: string; section: "REVENUE" | "EXPENSE"; ticket: string; returnTo: string;
  months: string[]; addMonth: string;
  autoRows: { label: string; value: number; note?: string }[]; rows: PnlEntryRow[];
  beforeAdd?: React.ReactNode;
}) {
  const total = autoRows.reduce((s, r) => s + r.value, 0) + rows.reduce((s, r) => s + r.amountCents, 0);
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <span className="text-sm font-semibold text-slate-700">{formatCents(total)}</span>
      </div>

      {autoRows.map((a) => (
        <div key={a.label} className="flex items-start justify-between gap-3 border-b border-slate-100 py-2">
          <div>
            <div className="text-sm font-medium text-slate-700">{a.label} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">auto</span></div>
            {a.note && <div className="text-[11px] text-slate-400">{a.note}</div>}
          </div>
          <div className="whitespace-nowrap text-sm font-semibold text-slate-800">{formatCents(a.value)}</div>
        </div>
      ))}

      {rows.map((r) => (
        <form key={r.id} method="POST" action="/api/console/pnl" className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input name="label" defaultValue={r.label} className="input min-w-[8rem] flex-1 py-1 text-sm" />
          <select name="month" defaultValue={r.month} className="input w-40 py-1 text-sm" title="Month">
            {(months.includes(r.month) ? months : [r.month, ...months]).map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
          </select>
          <select name="kind" defaultValue={r.kind} className="input w-28 py-1 text-sm">
            <option value="ACTUAL">Actual</option>
            <option value="FORECAST">Forecast</option>
          </select>
          <div className="flex items-center gap-1">
            <span className="text-slate-400">$</span>
            <input name="amount" type="text" inputMode="decimal" defaultValue={(r.amountCents / 100).toFixed(2)} className="input w-24 py-1 text-right text-sm" />
          </div>
          <button name="op" value="update" className="btn-chip-brand">Save</button>
          <button name="op" value="delete" className="btn-chip-danger" formNoValidate>Delete</button>
        </form>
      ))}

      {beforeAdd}

      <form method="POST" action="/api/console/pnl" className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="add" />
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="min-w-[9rem] flex-1">
          <label className="label text-xs">Add {title.toLowerCase()} line</label>
          <input name="label" required placeholder={section === "EXPENSE" ? "e.g. Court rental" : "e.g. Clinic revenue"} className="input py-1 text-sm" />
        </div>
        <div>
          <label className="label text-xs">Month</label>
          <select name="month" defaultValue={addMonth} className="input w-40 py-1 text-sm">
            {months.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Type</label>
          <select name="kind" defaultValue="ACTUAL" className="input w-28 py-1 text-sm">
            <option value="ACTUAL">Actual</option>
            <option value="FORECAST">Forecast</option>
          </select>
        </div>
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
