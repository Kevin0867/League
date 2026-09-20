import { PageHeader } from "@/components/RoadmapNote";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { pnlRange, pnlSeasonByMonth, monthLabel, today, type PnlRange, type PnlEntryRow, type CourtCost, type CourtCostLine, type CoachCost, type MonthPnl, type ForecastLine } from "@/lib/domain/pnl";
import { paymentsSince } from "@/lib/payments/reconcile";
import { phoenixDateInput, formatTime12 } from "@/lib/time";
import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "P&L" };

const RT = "/console/pnl";
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

// Months (YYYY-MM) spanned by a date range, inclusive.
function monthsFromTo(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  const ey = end.getUTCFullYear(), em = end.getUTCMonth();
  while ((y < ey || (y === ey && m <= em)) && out.length < 24) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}
const monthBounds = (m: string) => ({ from: `${m}-01`, to: `${m}-${new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()}` });

export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  // The active season drives the month presets and the season-wide view.
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { name: true, startDate: true, endDate: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { name: true, startDate: true, endDate: true } }));
  const seasonMonths = season ? monthsFromTo(season.startDate, season.endDate) : [];

  // Default range = since we started collecting (matches the Payments total) → today.
  const startDefault = phoenixDateInput(paymentsSince().date);
  const from = sp.from && dayRe.test(sp.from) ? sp.from : startDefault;
  const to = sp.to && dayRe.test(sp.to) ? sp.to : today();
  const valid = from <= to;
  // Statement basis: booked (collected / committed) vs forecast (full projection).
  const basis: "booked" | "forecast" = sp.basis === "booked" ? "booked" : "forecast";
  const showSeason = sp.season === "1";
  const qp = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ from, to, basis, ...(showSeason ? { season: "1" } : {}), ...extra });
    return `${RT}?${p.toString()}`;
  };

  const pnl: PnlRange = valid
    ? await pnlRange(from, to, basis)
    : { fromDay: from, toDay: to, months: [from.slice(0, 7)], basis, auto: { bookedCents: 0, forecastPlayers: 0, installmentCents: 0, unpaidFeeCents: 0, forecastLines: [], coachCostCents: 0, coaches: [], courtCostCents: 0, courtCosts: [] }, revenue: [], expenses: [], totals: { revenue: 0, expenses: 0, netIncome: 0, directorPayCents: 0, netToPureCents: 0, directorPct: 0.15 } };
  const t = pnl.totals;
  const returnTo = qp({});
  const addMonth = pnl.months[pnl.months.length - 1] ?? to.slice(0, 7);

  // The statement figures on the chosen basis (pnlRange already computed them).
  const stmt = { revenue: t.revenue, expenses: t.expenses, net: t.netIncome, director: t.directorPayCents, netToPure: t.netToPureCents };
  // Manual line items shown/counted for the basis: booked shows only ACTUAL.
  const revLines = basis === "booked" ? pnl.revenue.filter((r) => r.kind === "ACTUAL") : pnl.revenue;
  const expLines = basis === "booked" ? pnl.expenses.filter((r) => r.kind === "ACTUAL") : pnl.expenses;

  // Season-wide month-by-month breakdown (only computed when opened).
  const seasonRows: MonthPnl[] = showSeason && seasonMonths.length ? await pnlSeasonByMonth(seasonMonths) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="P&amp;L" subtitle="Pick a date range and a basis. Booked = actuals (collected revenue, delivered coach pay & court). Forecast = the full projection for the range (scheduled revenue, and coach pay + court fees for every scheduled practice AND league/championship night). Coach pay and court fees are automatic; add any other revenue or expense line." />

      {sp.ok === "added" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Line item added.</div>}
      {sp.ok === "saved" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Saved.</div>}
      {sp.ok === "deleted" && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">Line item removed.</div>}
      {sp.ok === "courtpulled" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Court rent pulled into editable line items{sp.n ? ` (${sp.n})` : ""} — edit any amount below.</div>}
      {sp.err === "fields" && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Give the line item a name, amount, and month.</div>}
      {sp.err && !["fields"].includes(sp.err) && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Something went wrong — please try again.</div>}

      {/* Timeframe + basis controls. */}
      <div className="card space-y-3">
        {/* Quick timeframe presets — season months + full season. */}
        {seasonMonths.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-slate-500">Timeframe:</span>
            {seasonMonths.map((m) => {
              const b = monthBounds(m);
              const active = from === b.from && to === b.to;
              return (
                <Link key={m} href={qp({ from: b.from, to: b.to })} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {monthLabel(m).replace(/ \d{4}$/, "")}
                </Link>
              );
            })}
            {season && (() => {
              const fs = phoenixDateInput(season.startDate), fe = phoenixDateInput(season.endDate);
              const active = from === fs && to === fe;
              return <Link href={qp({ from: fs, to: fe })} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Full season</Link>;
            })()}
          </div>
        )}
        {/* Custom range + revenue/statement basis. */}
        <div className="flex flex-wrap items-end gap-3">
          <form method="GET" action={RT} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="basis" value={basis} />
            {showSeason && <input type="hidden" name="season" value="1" />}
            <div>
              <label className="label text-xs">From</label>
              <input name="from" type="date" defaultValue={from} className="input py-1.5 text-sm" />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input name="to" type="date" defaultValue={to} className="input py-1.5 text-sm" />
            </div>
            <button className="btn-primary text-sm">Update</button>
          </form>
          {/* Revenue basis: booked vs forecast — flips the whole statement. */}
          <div>
            <span className="label text-xs">Revenue</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-sm">
              <Link href={qp({ basis: "booked" })} className={`px-3 py-1.5 ${basis === "booked" ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Booked</Link>
              <Link href={qp({ basis: "forecast" })} className={`px-3 py-1.5 ${basis === "forecast" ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Forecast</Link>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {basis === "booked"
            ? "Booked: revenue actually collected and delivered/committed expenses only."
            : "Forecast: full projection — scheduled/outstanding revenue and every expense line, incl. court + coach pay for practices AND league/championship nights (all coaches attend every league match)."}
        </p>
        {!valid && <p className="text-sm text-rose-700">The “from” date needs to be on or before the “to” date.</p>}
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
          ...(basis === "forecast" && pnl.auto.installmentCents > 0 ? [{ label: "Subscription installments (scheduled)", value: pnl.auto.installmentCents, note: "Remaining future installments from active payment plans (assigned players), each dated to its real Stripe charge date. Auto." }] : []),
          ...(basis === "forecast" && pnl.auto.unpaidFeeCents > 0 ? [{ label: "Unpaid fees — assigned players", value: pnl.auto.unpaidFeeCents, note: "Placed players who owe and aren't on a plan. If they've actually paid, reconcile in Payments and this drops off. Auto." }] : []),
        ]}
        rows={revLines}
        extraTotalCents={0}
        beforeAdd={basis === "forecast" && pnl.auto.installmentCents + pnl.auto.unpaidFeeCents > 0 ? <ForecastBreakdown installmentCents={pnl.auto.installmentCents} unpaidFeeCents={pnl.auto.unpaidFeeCents} lines={pnl.auto.forecastLines} /> : null}
      />

      {/* Expenses — coach pay + court fees are auto & basis-aware (booked =
          delivered, forecast = every scheduled practice in range). */}
      <Section
        title="Expenses"
        section="EXPENSE"
        ticket={ticket}
        returnTo={returnTo}
        months={pnl.months}
        addMonth={addMonth}
        autoRows={[]}
        autoNode={
          <div className="space-y-3">
            {pnl.auto.coaches.length > 0 && <CoachBreakdown coaches={pnl.auto.coaches} basis={basis} />}
            {pnl.auto.courtCosts.length > 0 && <CourtBreakdown courtCosts={pnl.auto.courtCosts} totalCents={pnl.auto.courtCostCents} basis={basis} />}
          </div>
        }
        extraTotalCents={pnl.auto.coachCostCents + pnl.auto.courtCostCents}
        rows={expLines}
      />

      {/* Bottom line — the statement waterfall */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Bottom line</h2>
          {/* Editable Director's pay percentage. */}
          <form method="POST" action="/api/console/pnl" className="flex items-center gap-1.5">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="setDirectorPct" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="text-xs text-slate-500">Director&apos;s pay</label>
            <input name="pct" type="number" step="0.1" min="0" max="100" defaultValue={+(t.directorPct * 100).toFixed(2)} className="input w-20 py-1 text-right text-sm" />
            <span className="text-xs text-slate-500">% of net</span>
            <button className="btn-chip-brand">Save</button>
          </form>
        </div>
        <dl className="divide-y divide-slate-100 text-sm">
          <WaterRow label={`Total revenue (${basis})`} value={stmt.revenue} strong />
          <WaterRow label="Total expenses" value={-stmt.expenses} />
          <WaterRow label="Net income" value={stmt.net} strong tone={stmt.net >= 0 ? "emerald" : "rose"} />
          <WaterRow label={`Director's pay (${+(t.directorPct * 100).toFixed(2)}% of net income)`} value={-stmt.director} />
          <WaterRow label="Net to PURE" value={stmt.netToPure} strong big tone={stmt.netToPure >= 0 ? "emerald" : "rose"} />
        </dl>
        <p className="mt-2 text-[11px] text-slate-400">Net income = revenue − expenses. The Director earns {+(t.directorPct * 100).toFixed(2)}% of net income; Net to PURE is what&apos;s left. Showing the <span className="font-medium">{basis}</span> basis (toggle above).</p>
      </div>

      {/* Summary — expandable */}
      <div className="card bg-slate-50">
        <h2 className="mb-1 font-semibold text-slate-900">Summary</h2>
        <p className="mb-3 text-xs text-slate-500">{basis === "booked" ? "Booked basis" : "Forecast basis"} · {from} → {to}. Click Revenue or Expenses to break them down.</p>
        <dl className="divide-y divide-slate-100 text-sm">
          {/* Revenue — expand to components */}
          <details className="py-1">
            <summary className="flex cursor-pointer items-center justify-between py-1">
              <span className="font-semibold text-slate-800">▸ Revenue</span>
              <span className="tabular-nums font-bold text-emerald-700">{formatCents(stmt.revenue)}</span>
            </summary>
            <div className="mt-1 space-y-1 pl-4 text-xs text-slate-600">
              <SumLine label="Collected" value={pnl.auto.bookedCents} />
              {basis === "forecast" && pnl.auto.installmentCents > 0 && <SumLine label="Subscription installments" value={pnl.auto.installmentCents} />}
              {basis === "forecast" && pnl.auto.unpaidFeeCents > 0 && <SumLine label="Unpaid — assigned players" value={pnl.auto.unpaidFeeCents} />}
              {revLines.map((r) => <SumLine key={r.id} label={`${r.label} (${r.kind === "FORECAST" ? "forecast" : "actual"})`} value={r.amountCents} />)}
            </div>
          </details>
          {/* Expenses — expand to components */}
          <details className="py-1">
            <summary className="flex cursor-pointer items-center justify-between py-1">
              <span className="font-semibold text-slate-800">▸ Expenses</span>
              <span className="tabular-nums font-bold text-rose-700">{formatCents(stmt.expenses)}</span>
            </summary>
            <div className="mt-1 space-y-1 pl-4 text-xs text-slate-600">
              {pnl.auto.coaches.map((c) => <SumLine key={c.coachId} label={`Coach — ${c.name}`} value={c.cents} />)}
              {pnl.auto.courtCosts.map((c) => <SumLine key={c.facilityId} label={`Court — ${c.facilityName}`} value={c.cents} />)}
              {expLines.map((r) => <SumLine key={r.id} label={`${r.label} (${r.kind === "FORECAST" ? "forecast" : "actual"})`} value={r.amountCents} />)}
            </div>
          </details>
          <WaterRow label="Net income" value={stmt.net} strong tone={stmt.net >= 0 ? "emerald" : "rose"} />
          <WaterRow label={`Director's pay (${+(t.directorPct * 100).toFixed(2)}%)`} value={stmt.director} />
          <WaterRow label="Net to PURE" value={stmt.netToPure} strong tone={stmt.netToPure >= 0 ? "emerald" : "rose"} />
        </dl>
      </div>

      {/* Season-wide view — month by month, following the season calendar */}
      {seasonMonths.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Season breakdown{season ? ` — ${season.name}` : ""}</h2>
              <p className="mt-0.5 text-xs text-slate-500">Every month of the season, {basis} basis. Forecast projects coach pay &amp; court fees for all scheduled practices (from the schedule &amp; facility rates), plus scheduled revenue. Toggle Booked/Forecast above.</p>
            </div>
            <Link href={qp({ season: showSeason ? "0" : "1" })} className="btn-secondary text-sm">{showSeason ? "Hide" : "Show season breakdown"}</Link>
          </div>
          {showSeason && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-slate-400">
                  <tr className="border-b border-slate-200 text-xs">
                    <th className="px-2 py-1.5 text-left font-medium">Month</th>
                    <th className="px-2 py-1.5 text-right font-medium">Revenue</th>
                    <th className="px-2 py-1.5 text-right font-medium">Expenses</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net income</th>
                    <th className="px-2 py-1.5 text-right font-medium">Director&apos;s pay</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net to PURE</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonRows.map((r) => {
                    const rev = basis === "booked" ? r.bookedRevenueCents : r.forecastRevenueCents;
                    const exp = basis === "booked" ? r.actualExpenseCents : r.forecastExpenseCents;
                    const net = basis === "booked" ? r.bookedNetCents : r.forecastNetCents;
                    const dir = basis === "booked" ? r.bookedDirectorCents : r.forecastDirectorCents;
                    const pure = basis === "booked" ? r.bookedNetToPureCents : r.forecastNetToPureCents;
                    return (
                      <tr key={r.month} className="border-b border-slate-100">
                        <td className="px-2 py-1.5"><Link href={qp(monthBounds(r.month))} className="text-brand-700 hover:underline">{monthLabel(r.month)}</Link></td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">
                          {formatCents(rev)}
                          {basis === "forecast" && (r.installmentCents > 0 || r.unpaidFeeCents > 0) && (
                            <div className="text-[10px] font-normal text-slate-400">
                              {r.installmentCents > 0 ? `${formatCents(r.installmentCents)} installments` : ""}
                              {r.installmentCents > 0 && r.unpaidFeeCents > 0 ? " · " : ""}
                              {r.unpaidFeeCents > 0 ? `${formatCents(r.unpaidFeeCents)} unpaid` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{formatCents(exp)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${net >= 0 ? "text-slate-800" : "text-rose-700"}`}>{formatCents(net)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatCents(dir)}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${pure >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(pure)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const sum = (pick: (r: MonthPnl) => number) => seasonRows.reduce((s, r) => s + pick(r), 0);
                    const rev = basis === "booked" ? sum((r) => r.bookedRevenueCents) : sum((r) => r.forecastRevenueCents);
                    const exp = basis === "booked" ? sum((r) => r.actualExpenseCents) : sum((r) => r.forecastExpenseCents);
                    const net = basis === "booked" ? sum((r) => r.bookedNetCents) : sum((r) => r.forecastNetCents);
                    const dir = basis === "booked" ? sum((r) => r.bookedDirectorCents) : sum((r) => r.forecastDirectorCents);
                    const pure = basis === "booked" ? sum((r) => r.bookedNetToPureCents) : sum((r) => r.forecastNetToPureCents);
                    return (
                      <tr className="border-t-2 border-slate-300 font-semibold">
                        <td className="px-2 py-2">Season total</td>
                        <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{formatCents(rev)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-rose-700">{formatCents(exp)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${net >= 0 ? "text-slate-900" : "text-rose-700"}`}>{formatCents(net)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-700">{formatCents(dir)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${pure >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatCents(pure)}</td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Revenue, coach pay, and court fees are computed automatically from real payments, the schedule, and facility rates — basis-aware
        (Booked = delivered/collected, Forecast = the whole range projected). Add any other revenue or expense line; line items are tagged to a
        month and count toward the range&apos;s months.
      </p>
    </div>
  );
}

// A session date "Mon, Sep 15" — rendered in UTC since session dates are noon-UTC
// day anchors.
function fmtDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
// Total hours for a court line, noting the tier split so the math is checkable.
function fmtHours(ln: CourtCostLine): string {
  const total = ln.dayHours + ln.eveningHours;
  const h = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (ln.weekend) return `${h(total)} (wknd)`;
  if (ln.dayHours > 0 && ln.eveningHours > 0) return `${h(total)} (${h(ln.dayHours)} day + ${h(ln.eveningHours)} eve)`;
  if (ln.eveningHours > 0) return `${h(total)} (eve)`;
  return `${h(total)} (day)`;
}
// Effective per-court-per-hour rate for a line (cost ÷ courts ÷ hours) — for a
// single-tier day it's the exact rate; for a mixed day+evening session it's the
// blended rate. Makes a facility whose evening/weekend rate ≠ its day rate obvious.
function fmtRate(ln: CourtCostLine): string {
  const totalHours = ln.dayHours + ln.eveningHours;
  if (totalHours <= 0 || ln.courts <= 0) return "—";
  const perCents = ln.cents / (ln.courts * totalHours);
  const blended = ln.dayHours > 0 && ln.eveningHours > 0 && !ln.weekend;
  return `${formatCents(Math.round(perCents))}${blended ? "*" : ""}`;
}

const COACH_ROLE_LABEL: Record<string, string> = { PRIMARY: "Primary", ASSISTANT: "Assistant", SUBSTITUTE: "Sub", BACKUP: "Backup" };

// Coach session pay broken out per coach — each expands to the individual days,
// times, teams, and per-session pay behind that coach's total.
function CoachBreakdown({ coaches, basis }: { coaches: CoachCost[]; basis: "booked" | "forecast" }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Coach session pay ({basis === "forecast" ? "all scheduled" : "delivered"}) <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">auto</span></span>
        <span className="text-sm font-semibold text-slate-800">{formatCents(coaches.reduce((s, c) => s + c.cents, 0))}</span>
      </div>
      <div className="space-y-1.5">
        {coaches.map((c) => (
          <details key={c.coachId} className="rounded border border-slate-200 bg-white">
            <summary className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-xs">
              <span className="font-medium text-slate-700">{c.name} <span className="text-slate-400">({c.lines.length} {c.lines.length === 1 ? "session" : "sessions"})</span></span>
              <span className="font-semibold text-slate-800">{formatCents(c.cents)}</span>
            </summary>
            <table className="w-full border-t border-slate-100 text-[11px] text-slate-600">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-100">
                  <th className="px-2.5 py-1 text-left font-medium">Day</th>
                  <th className="px-2 py-1 text-left font-medium">Time</th>
                  <th className="px-2 py-1 text-left font-medium">Team</th>
                  <th className="px-2 py-1 text-left font-medium">Role</th>
                  <th className="px-2.5 py-1 text-right font-medium">Pay</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((ln, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-2.5 py-1">{fmtDay(ln.day)}</td>
                    <td className="px-2 py-1">{formatTime12(ln.startTime)}</td>
                    <td className="px-2 py-1">{ln.teamName ?? "—"}</td>
                    <td className="px-2 py-1">{COACH_ROLE_LABEL[ln.role] ?? ln.role}</td>
                    <td className="px-2.5 py-1 text-right font-medium text-slate-700">{formatCents(ln.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </div>
  );
}

// Court fees — auto from facility rates, per facility, each expandable to the
// per-practice audit (day, courts, hours, effective rate, cost). Basis-aware:
// delivered practices only vs every scheduled practice in range.
function CourtBreakdown({ courtCosts, totalCents, basis }: { courtCosts: CourtCost[]; totalCents: number; basis: "booked" | "forecast" }) {
  const nameCounts = new Map<string, number>();
  for (const c of courtCosts) nameCounts.set(c.facilityName, (nameCounts.get(c.facilityName) ?? 0) + 1);
  const hasDupes = [...nameCounts.values()].some((n) => n > 1);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Court fees ({basis === "forecast" ? "all scheduled" : "delivered"}) <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">auto</span></span>
        <span className="text-sm font-semibold text-slate-800">{formatCents(totalCents)}</span>
      </div>
      {hasDupes && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          A facility name appears more than once — two facility records share a name with practices split across them (often an old duplicate with a stale rate). Fix the rates or move the practices onto the correct record.
        </div>
      )}
      <div className="space-y-1.5">
        {courtCosts.map((c) => (
          <details key={c.facilityId} className="rounded border border-slate-200 bg-white">
            <summary className="cursor-pointer px-2.5 py-1.5 text-xs">
              <span className="flex items-center justify-between">
                <span className="font-medium text-slate-700">{c.facilityName} <span className="text-slate-400">({c.lines.length} {c.lines.length === 1 ? "day" : "days"})</span>{(nameCounts.get(c.facilityName) ?? 0) > 1 && <span className="ml-1.5 rounded bg-rose-100 px-1 py-0.5 text-[10px] font-semibold text-rose-700">duplicate name</span>}</span>
                <span className="font-semibold text-slate-800">{formatCents(c.cents)}</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Saved rates — Day {c.dayRateCents != null ? formatCents(c.dayRateCents) : "—"} · Evening {c.eveningRateCents != null ? formatCents(c.eveningRateCents) : "(uses day)"} · Weekend {c.weekendRateCents != null ? formatCents(c.weekendRateCents) : "(uses day/eve)"} · eve after {c.eveningStartsAt}
              </span>
            </summary>
            <table className="w-full border-t border-slate-100 text-[11px] text-slate-600">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-100">
                  <th className="px-2.5 py-1 text-left font-medium">Day</th>
                  <th className="px-2 py-1 text-right font-medium">Courts</th>
                  <th className="px-2 py-1 text-right font-medium">Hours</th>
                  <th className="px-2 py-1 text-right font-medium">$/ct/hr</th>
                  <th className="px-2.5 py-1 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((ln, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-2.5 py-1">{fmtDay(ln.day)}</td>
                    <td className="px-2 py-1 text-right">{ln.courts}</td>
                    <td className="px-2 py-1 text-right">{fmtHours(ln)}</td>
                    <td className="px-2 py-1 text-right">{fmtRate(ln)}</td>
                    <td className="px-2.5 py-1 text-right font-medium text-slate-700">{formatCents(ln.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">$/ct/hr = cost ÷ courts ÷ hours (<span className="font-mono">*</span> = blended day+evening). Set court rates on each facility. {basis === "forecast" ? "Forecast counts every scheduled practice in range." : "Booked counts delivered practices only."}</p>
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

// A row in the bottom-line waterfall. A negative value renders as "− $X" (a
// subtraction step); positive renders plainly.
function WaterRow({ label, value, strong, big, tone }: { label: string; value: number; strong?: boolean; big?: boolean; tone?: "emerald" | "rose" }) {
  const neg = value < 0;
  const color = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : neg ? "text-slate-600" : "text-slate-900";
  return (
    <div className="flex items-center justify-between py-2">
      <span className={`${strong ? "font-semibold text-slate-900" : "text-slate-600"} ${big ? "text-base" : "text-sm"}`}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-bold" : "font-medium"} ${big ? "text-xl" : "text-sm"} ${color}`}>
        {neg ? `− ${formatCents(Math.abs(value))}` : formatCents(value)}
      </span>
    </div>
  );
}

// What makes up the forecast (scheduled/outstanding) revenue — installments
// still due vs unpaid one-time fees, and the players behind each — so a forecast
// that looks too high can be audited (e.g. a family that already paid but whose
// invoice wasn't marked paid still shows as an unpaid fee).
function ForecastBreakdown({ installmentCents, unpaidFeeCents, lines }: { installmentCents: number; unpaidFeeCents: number; lines: ForecastLine[] }) {
  const total = installmentCents + unpaidFeeCents;
  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="flex cursor-pointer items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">What&apos;s in the forecast? <span className="font-normal text-slate-400">({lines.length} player{lines.length === 1 ? "" : "s"})</span></span>
        <span className="font-semibold text-slate-800">{formatCents(total)}</span>
      </summary>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between font-medium text-slate-600"><span>Subscription installments still due</span><span className="tabular-nums">{formatCents(installmentCents)}</span></div>
        <div className="flex justify-between font-medium text-slate-600"><span>Unpaid one-time fees</span><span className="tabular-nums">{formatCents(unpaidFeeCents)}</span></div>
        <p className="pt-1 text-[11px] text-slate-400">If this looks too high, it usually means invoices marked outstanding for families who already paid (reconcile Payments), or players on payment plans with installments still due.</p>
        <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-400">
              <tr className="border-b border-slate-100">
                <th className="px-2 py-1 text-left font-medium">Player</th>
                <th className="px-2 py-1 text-right font-medium">Installments</th>
                <th className="px-2 py-1 text-right font-medium">Unpaid fee</th>
                <th className="px-2 py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-2 py-1 text-slate-700">{l.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-500">{l.installmentCents ? formatCents(l.installmentCents) : "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-500">{l.unpaidFeeCents ? formatCents(l.unpaidFeeCents) : "—"}</td>
                  <td className="px-2 py-1 text-right font-medium tabular-nums text-slate-700">{formatCents(l.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

// A compact label/value line inside an expandable summary section.
function SumLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums font-medium text-slate-700">{formatCents(value)}</span>
    </div>
  );
}

function Section({
  title, section, ticket, returnTo, months, addMonth, autoRows, rows, beforeAdd, autoNode, extraTotalCents = 0,
}: {
  title: string; section: "REVENUE" | "EXPENSE"; ticket: string; returnTo: string;
  months: string[]; addMonth: string;
  autoRows: { label: string; value: number; note?: string }[]; rows: PnlEntryRow[];
  beforeAdd?: React.ReactNode;
  autoNode?: React.ReactNode;      // custom auto content (e.g. the per-coach breakdown)
  extraTotalCents?: number;        // cents to add to the header total for autoNode content
}) {
  const total = autoRows.reduce((s, r) => s + r.value, 0) + rows.reduce((s, r) => s + r.amountCents, 0) + extraTotalCents;
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <span className="text-sm font-semibold text-slate-700">{formatCents(total)}</span>
      </div>

      {autoNode && <div className="mb-2 border-b border-slate-100 pb-2">{autoNode}</div>}

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
