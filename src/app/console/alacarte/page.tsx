import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { COACH_TEACHES, DIRECTOR_TEACHES } from "@/lib/domain/splits";
import { mintConsoleTicket } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private", SEMI_PRIVATE: "Semi-private", CLINIC: "Clinic" };

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage private lessons.",
  facility: "Facility not found.",
  notallowed: "That venue does not permit private lessons — negotiate it into the agreement first.",
  notfound: "Booking not found.",
  op: "Unknown operation.",
};

const OKS: Record<string, string> = {
  createOffering: "Offering added.",
  respondToBooking: "Booking updated.",
  deliverBooking: "Booking delivered and split recorded.",
};

export default async function AlaCartePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const [offerings, bookings, alaFacilities, coaches] = await Promise.all([
    prisma.alaCarteOffering.findMany({ include: { facility: true, coach: { include: { person: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.alaCarteBooking.findMany({
      include: { offering: { include: { facility: true } }, client: true, coach: { include: { person: true } } },
      orderBy: { createdAt: "desc" }, take: 40,
    }),
    prisma.facility.findMany({ where: { alaCarteAllowed: true }, orderBy: { name: "asc" } }),
    prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Private lessons & clinics" subtitle="PURE sets prices by venue. Court cost comes off the top, then the split — the applied rates are stamped onto each transaction." />

      {sp.ok && OKS[sp.ok] && (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{OKS[sp.ok]}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{ERRORS[sp.err] ?? "Action failed."}</p>
      )}

      {/* Split reference */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SplitCard title="Assigned coach teaches" rates={COACH_TEACHES} />
        <SplitCard title="Academy Director teaches" rates={DIRECTOR_TEACHES} note="Director takes coach + director lines (70%); PURE retains 30%." />
      </div>

      {/* Create offering */}
      <form method="POST" action="/api/console/alacarte" className="card grid gap-3 sm:grid-cols-5 sm:items-end">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="createOffering" />
        <div className="sm:col-span-2">
          <label className="label">Title</label>
          <input name="title" className="input" placeholder="60-min private lesson" required />
        </div>
        <div>
          <label className="label">Type</label>
          <select name="type" className="input">
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Venue</label>
          <select name="facilityId" className="input" required>
            <option value="">—</option>
            {alaFacilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Coach</label>
          <select name="coachId" className="input">
            <option value="">Any</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.person.firstName} {c.person.lastName}</option>)}
          </select>
        </div>
        <div className="sm:col-span-4">
          <label className="label">Price ($)</label>
          <input name="price" type="number" min={0} step="0.01" className="input" required />
        </div>
        <button className="btn-primary">Add offering</button>
      </form>

      {alaFacilities.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No facilities permit private lessons yet. Enable it on a facility&apos;s agreement first.
        </p>
      )}

      {/* Catalog */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Catalog</h2>
        {offerings.length === 0 ? (
          <p className="text-sm text-slate-400">No offerings yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((o) => (
              <div key={o.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{o.title}</span>
                  <span className="font-semibold text-brand-700">{formatCents(o.priceCents)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {TYPE_LABEL[o.type]} · {o.facility.name}{o.coach ? ` · ${o.coach.person.firstName} ${o.coach.person.lastName}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bookings */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-400">No bookings yet.</p>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{b.offering.title}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {b.client.firstName} {b.client.lastName} · {b.offering.facility.name}
                      {b.coach ? ` · ${b.coach.person.firstName} ${b.coach.person.lastName}` : ""}
                    </span>
                  </div>
                  <StatusBadge status={b.status} />
                </div>

                {b.status === "REQUESTED" && (
                  <div className="mt-2 flex gap-2">
                    <form method="POST" action="/api/console/alacarte"><input type="hidden" name="ticket" value={ticket} /><input type="hidden" name="op" value="respondToBooking" /><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="decision" value="ACCEPT" /><button className="btn-secondary text-xs">Accept</button></form>
                    <form method="POST" action="/api/console/alacarte"><input type="hidden" name="ticket" value={ticket} /><input type="hidden" name="op" value="respondToBooking" /><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="decision" value="DECLINE" /><button className="btn-ghost text-xs">Decline</button></form>
                  </div>
                )}

                {b.status === "ACCEPTED" && (
                  <form method="POST" action="/api/console/alacarte" className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="deliverBooking" />
                    <input type="hidden" name="bookingId" value={b.id} />
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input type="checkbox" name="directorTaught" /> Director taught
                    </label>
                    <div>
                      <label className="label text-xs">Court cost ($)</label>
                      <input name="courtCost" type="number" min={0} step="0.01" className="input py-1 text-sm" placeholder="auto" />
                    </div>
                    <button className="btn-primary text-xs">Mark delivered & split</button>
                  </form>
                )}

                {b.status === "DELIVERED" && (
                  <div className="mt-2 text-xs text-slate-500">
                    Gross {formatCents(b.grossCents)} − court {formatCents(b.courtCostCents)} = net {formatCents(b.netCents)} →
                    <span className="text-slate-700"> coach {formatCents(b.coachCents)}</span>,
                    director {formatCents(b.directorCents)}, PURE {formatCents(b.pureCents)}
                    {b.directorTaught ? " (director rates)" : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SplitCard({ title, rates, note }: { title: string; rates: { coachPct: number; directorPct: number; purePct: number }; note?: string }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 flex gap-4 text-sm">
        <span>Coach <b>{Math.round(rates.coachPct * 100)}%</b></span>
        <span>Director <b>{Math.round(rates.directorPct * 100)}%</b></span>
        <span>PURE <b>{Math.round(rates.purePct * 100)}%</b></span>
      </div>
      {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
    </div>
  );
}
