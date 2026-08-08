import { prisma } from "@/lib/db";
import { PageHeader, RoadmapNote } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const [inbound, outbound] = await Promise.all([
    prisma.payment.findMany({ where: { direction: "IN" }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({ where: { direction: "OUT" }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 50 }),
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

      <RoadmapNote phase="Phase 1">
        Stripe hosted checkout wires into the “Pay now” action once keys are provisioned
        (<code>STRIPE_SECRET_KEY</code>). Payment is requested only after a player is
        assigned a team, coach, location, day, and time. Coach payout register and
        month-end facility statements land in Phase 2.
      </RoadmapNote>

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
