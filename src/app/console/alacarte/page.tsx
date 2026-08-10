import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { COACH_TEACHES, DIRECTOR_TEACHES } from "@/lib/domain/splits";
import { mintConsoleTicket } from "@/lib/auth";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { LessonSetupForm } from "@/components/LessonSetupForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private", SEMI_PRIVATE: "Semi-private", CLINIC: "Clinic" };

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage private lessons.",
  facility: "Facility not found.",
  notallowed: "That venue does not permit private lessons — negotiate it into the agreement first.",
  notfound: "Booking not found.",
  noplayers: "Add at least one participant with a name and email.",
  op: "Unknown operation.",
};

const OKS: Record<string, string> = {
  createOffering: "Offering added.",
  respondToBooking: "Booking updated.",
  deliverBooking: "Booking delivered and split recorded.",
  lessonSent: "Lesson created — payment request sent.",
};

export default async function AlaCartePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const [offerings, bookings, alaFacilities, coaches, activeCounts] = await Promise.all([
    prisma.alaCarteOffering.findMany({ include: { facility: true, coach: { include: { person: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.alaCarteBooking.findMany({
      include: { offering: { include: { facility: true } }, client: true, coach: { include: { person: true } } },
      orderBy: { createdAt: "desc" }, take: 40,
    }),
    prisma.facility.findMany({ where: { alaCarteAllowed: true }, orderBy: { name: "asc" } }),
    prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } }),
    // Spots taken per offering — anything not cancelled/declined counts.
    prisma.alaCarteBooking.groupBy({
      by: ["offeringId"],
      where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
      _count: { _all: true },
    }),
  ]);
  const takenByOffering = new Map(activeCounts.map((c) => [c.offeringId, c._count._all]));

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
      <form method="POST" action="/api/console/alacarte" className="card grid gap-3 sm:grid-cols-6 sm:items-end">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="createOffering" />
        <div className="sm:col-span-3">
          <label className="label">Title</label>
          <input name="title" className="input" placeholder="Saturday skills clinic" required />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Type</label>
          <select name="type" className="input">
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className="label">Price / person ($)</label>
          <input name="price" type="number" min={0} step="0.01" className="input" placeholder="75" required />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Capacity</label>
          <input name="capacity" type="number" min={1} step="1" className="input" placeholder="8" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Venue</label>
          <select name="facilityId" className="input" required>
            <option value="">—</option>
            {alaFacilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Coach</label>
          <select name="coachId" className="input">
            <option value="">Any / TBD</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.person.firstName} {c.person.lastName}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Date &amp; time</label>
          <input name="scheduledAt" type="datetime-local" className="input" />
        </div>
        <div className="sm:col-span-6">
          <label className="label">Description <span className="font-normal text-slate-400">(shown on the public signup page)</span></label>
          <textarea name="description" rows={2} className="input" placeholder="What to expect, who it's for, what to bring…" />
        </div>
        <div className="sm:col-span-5 text-xs text-slate-500">
          Clinics with a capacity appear on the public <span className="font-medium">Clinics</span> page with a direct signup link.
          Private &amp; semi-private lessons stay internal — set those up with a payment request below.
        </div>
        <button className="btn-primary">Add offering</button>
      </form>

      {alaFacilities.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No facilities permit private lessons yet. Enable it on a facility&apos;s agreement first.
        </p>
      )}

      {/* Admin-arranged lesson + payment request */}
      {alaFacilities.length > 0 && (
        <LessonSetupForm
          ticket={ticket}
          facilities={alaFacilities.map((f) => ({ id: f.id, name: f.name }))}
          coaches={coaches.map((c) => ({ id: c.id, name: `${c.person.firstName} ${c.person.lastName}` }))}
        />
      )}

      {/* Catalog */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-900">Catalog</h2>
        {offerings.length === 0 ? (
          <p className="text-sm text-slate-400">No offerings yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((o) => {
              const taken = takenByOffering.get(o.id) ?? 0;
              const spotsLeft = o.capacity != null ? Math.max(0, o.capacity - taken) : null;
              const isClinic = o.type === "CLINIC";
              const publicListed = isClinic && o.active && o.capacity != null;
              return (
                <div key={o.id} className={`rounded-lg border p-3 ${o.active ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-70"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-slate-800">{o.title}</span>
                    <span className="whitespace-nowrap font-semibold text-brand-700">{formatCents(o.priceCents)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {TYPE_LABEL[o.type]} · {o.facility.name}{o.coach ? ` · ${o.coach.person.firstName} ${o.coach.person.lastName}` : ""}
                  </div>
                  {o.scheduledAt && (
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(o.scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  )}
                  {o.capacity != null && (
                    <div className="mt-1 text-xs">
                      <span className={spotsLeft === 0 ? "font-medium text-rose-600" : "text-emerald-700"}>
                        {spotsLeft === 0 ? "Full" : `${spotsLeft} of ${o.capacity} spot${o.capacity === 1 ? "" : "s"} left`}
                      </span>
                    </div>
                  )}
                  {!o.active && <div className="mt-1 text-xs font-medium text-slate-400">Inactive — hidden from public</div>}

                  {publicListed && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CopyLinkButton path={`/clinics/${o.id}`} />
                      <Link href={`/clinics/${o.id}`} target="_blank" className="text-xs text-brand-600 underline">Open</Link>
                    </div>
                  )}

                  <form method="POST" action="/api/console/alacarte" className="mt-2">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="toggleOffering" />
                    <input type="hidden" name="offeringId" value={o.id} />
                    <input type="hidden" name="active" value={o.active ? "0" : "1"} />
                    <button className="text-xs text-slate-500 hover:underline">{o.active ? "Deactivate" : "Reactivate"}</button>
                  </form>
                </div>
              );
            })}
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
