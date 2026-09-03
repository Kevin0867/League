import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { PrintButton } from "@/components/PrintButton";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { garmentLabel, sizeLabel, APPAREL_GARMENTS, APPAREL_SIZES } from "@/lib/domain/apparel";

export const dynamic = "force-dynamic";

export default async function ApparelReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const showAll = sp.all === "1";

  const items = await prisma.apparelOrderItem.findMany({
    include: {
      payment: {
        select: {
          status: true,
          party: { select: { firstName: true, lastName: true } },
          // Standalone apparel orders carry the team they're for directly, since
          // the buyer may not be on that roster.
          apparelTeam: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Resolve player names + their team for each order line.
  const personIds = [...new Set(items.map((i) => i.personId).filter(Boolean) as string[])];
  const [people, memberships] = await Promise.all([
    personIds.length ? prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
    personIds.length ? prisma.teamMember.findMany({ where: { personId: { in: personIds } }, select: { personId: true, team: { select: { name: true } } } }) : [],
  ]);
  const nameById = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const teamById = new Map(memberships.map((m) => [m.personId, m.team.name]));

  const paid = items.filter((i) => i.payment.status === "PAID");

  // Printer tally — paid only, grouped garment → size → qty.
  const tally: Record<string, Record<string, number>> = {};
  let totalPieces = 0;
  for (const it of paid) {
    (tally[it.garment] ??= {})[it.size] = (tally[it.garment]?.[it.size] ?? 0) + it.quantity;
    totalPieces += it.quantity;
  }

  const count = (status: string) => paid.filter((i) => i.fulfillment === status).reduce((s, i) => s + i.quantity, 0);
  const pending = count("PENDING");
  const ordered = count("ORDERED");
  const delivered = count("DELIVERED");

  const rows = (showAll ? items : paid).map((i) => ({
    id: i.id,
    player: i.personId ? nameById.get(i.personId) ?? "" : "",
    payer: i.payment.party ? `${i.payment.party.firstName} ${i.payment.party.lastName}` : "",
    team: (i.personId ? teamById.get(i.personId) : null) ?? i.payment.apparelTeam?.name ?? "—",
    garment: garmentLabel(i.garment),
    size: sizeLabel(i.size),
    garmentKey: i.garment,
    sizeKey: i.size,
    qty: i.quantity,
    paid: i.payment.status === "PAID",
    fulfillment: i.fulfillment,
  }));

  // Fixed order for tally display.
  const sizeOrder = APPAREL_SIZES.map((s) => s.key);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Apparel orders" subtitle="What to order for the printer, and where each piece is in fulfillment." />
        <div className="flex items-center gap-2">
          <a href={showAll ? "/console/apparel" : "/console/apparel?all=1"} className="btn-secondary text-sm">
            {showAll ? "Paid only" : "Show unpaid too"}
          </a>
          <a href="/console/export/apparel" className="btn-secondary text-sm">↓ CSV</a>
          <PrintButton label="Print" />
        </div>
      </div>

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sp.ok === "advanced" ? `${sp.n ?? ""} item(s) updated.` : sp.ok === "itemedited" ? "Apparel choice updated." : "Updated."}
        </p>
      )}

      {/* Printer tally */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Order tally — paid</h2>
          <span className="text-sm text-slate-500">{totalPieces} piece{totalPieces === 1 ? "" : "s"}</span>
        </div>
        {paid.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No paid apparel orders yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {APPAREL_GARMENTS.filter((g) => tally[g.key]).map((g) => {
              const sizes = tally[g.key];
              const gTotal = Object.values(sizes).reduce((s, n) => s + n, 0);
              return (
                <div key={g.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{g.label}</span>
                    <span className="text-xs text-slate-400">{gTotal} total</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {sizeOrder.filter((s) => sizes[s]).map((s) => (
                      <span key={s} className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-700">
                        {sizeLabel(s)} <span className="font-semibold">×{sizes[s]}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fulfillment */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Fulfillment</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatusTile label="To order" value={pending} tone="amber" />
          <StatusTile label="Ordered" value={ordered} tone="brand" />
          <StatusTile label="Delivered" value={delivered} tone="emerald" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Advance ticket={ticket} from="PENDING" to="ORDERED" label="Mark all to-order → ordered" disabled={pending === 0} />
          <Advance ticket={ticket} from="ORDERED" to="DELIVERED" label="Mark ordered → delivered" disabled={ordered === 0} />
        </div>
        <p className="mt-2 text-xs text-slate-400">Bulk actions apply to paid orders only.</p>
      </div>

      {/* Line items */}
      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold text-slate-900">Orders {showAll ? "(all)" : "(paid)"}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Player</th>
              <th>Team</th>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th>Payment</th>
              <th>Fulfillment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 font-medium text-slate-800">{r.player || <span className="text-slate-400">{r.payer}</span>}</td>
                <td className="text-slate-600">{r.team}</td>
                <td className="text-slate-600">
                  <details>
                    <summary className="cursor-pointer hover:text-brand-700" title="Change garment or size">{r.garment} · {r.size}</summary>
                    <form method="POST" action="/api/console/apparel" className="mt-1.5 flex flex-wrap items-end gap-1.5">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="editItem" />
                      <input type="hidden" name="id" value={r.id} />
                      <select name="garment" defaultValue={r.garmentKey} className="input py-1 text-xs">
                        {APPAREL_GARMENTS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                      </select>
                      <select name="size" defaultValue={r.sizeKey} className="input py-1 text-xs">
                        <optgroup label="Youth">{APPAREL_SIZES.filter((s) => s.key.startsWith("Y")).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
                        <optgroup label="Adult">{APPAREL_SIZES.filter((s) => s.key.startsWith("A")).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
                      </select>
                      <input name="quantity" type="number" min={1} max={20} defaultValue={r.qty} className="input w-14 py-1 text-xs" />
                      <button className="btn-secondary py-1 text-xs">Save</button>
                    </form>
                  </details>
                </td>
                <td className="text-right text-slate-600">{r.qty}</td>
                <td>{r.paid ? <span className="badge bg-emerald-100 text-emerald-800">paid</span> : <span className="badge bg-amber-100 text-amber-800">unpaid</span>}</td>
                <td>
                  {r.paid ? (
                    <form method="POST" action="/api/console/apparel" className="flex items-center gap-2">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="setOne" />
                      <input type="hidden" name="id" value={r.id} />
                      <span className="text-xs text-slate-500">{r.fulfillment === "PENDING" ? "to order" : r.fulfillment.toLowerCase()}</span>
                      {r.fulfillment !== "ORDERED" && <button name="to" value="ORDERED" className="text-xs font-semibold text-brand-700 hover:underline">ordered</button>}
                      {r.fulfillment !== "DELIVERED" && <button name="to" value="DELIVERED" className="text-xs font-semibold text-brand-700 hover:underline">delivered</button>}
                      {r.fulfillment !== "PENDING" && <button name="to" value="PENDING" className="text-xs text-slate-400 hover:underline">reset</button>}
                    </form>
                  ) : (
                    <span className="text-xs text-slate-400">awaiting payment</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusTile({ label, value, tone }: { label: string; value: number; tone: "amber" | "brand" | "emerald" }) {
  const c = tone === "amber" ? "text-amber-700" : tone === "brand" ? "text-brand-700" : "text-emerald-700";
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${c}`}>{value}</div>
    </div>
  );
}

function Advance({ ticket, from, to, label, disabled }: { ticket: string; from: string; to: string; label: string; disabled: boolean }) {
  return (
    <form method="POST" action="/api/console/apparel">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="advance" />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <button className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled}>{label}</button>
    </form>
  );
}
