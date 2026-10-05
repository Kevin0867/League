import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { COACH_TEACHES, DIRECTOR_TEACHES } from "@/lib/domain/splits";
import { mintConsoleTicket } from "@/lib/auth";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { LessonSetupForm } from "@/components/LessonSetupForm";
import { LessonManageControls, type ManageBooking } from "@/components/LessonManageControls";
import { ClassBuilderForm } from "@/components/ClassBuilderForm";
import { describeTarget } from "@/lib/domain/classAudience";
import Link from "next/link";
import { formatDateTime12 } from "@/lib/time";
import { requireAdmin } from "@/lib/rbac";

// datetime-local value from a stored Date, using UTC parts so it round-trips
// through the route's `new Date(raw)` (which parses in the container's UTC tz) —
// matching the single-clinic path's existing behavior.
function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

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
  editClass: "Class updated.",
  respondToBooking: "Booking updated.",
  deliverBooking: "Booking delivered and split recorded.",
  lessonSent: "Lesson created — payment request sent.",
};

export default async function AlaCartePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const [offerings, bookings, alaFacilities, coaches, activeCounts] = await Promise.all([
    prisma.alaCarteOffering.findMany({ include: { facility: true, coach: { include: { person: true } }, classSessions: { orderBy: { scheduledAt: "asc" } } }, orderBy: { createdAt: "desc" } }),
    prisma.alaCarteBooking.findMany({
      include: { offering: { include: { facility: true } }, client: true, coach: { include: { person: true } } },
      orderBy: { createdAt: "desc" }, take: 40,
    }),
    prisma.facility.findMany({ where: { alaCarteAllowed: true, archived: false }, orderBy: { name: "asc" } }),
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
      {sp.lok === "moved" && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Lesson moved — the player and coach were notified.</p>}
      {sp.lok === "cancelled" && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Lesson cancelled{sp.rc ? ` — refunded ${formatCents(parseInt(sp.rc, 10) || 0)}` : ""}.</p>}
      {sp.lerr && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{decodeURIComponent(sp.lerr)}</p>}

      {/* Split reference */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SplitCard title="Assigned coach teaches" rates={COACH_TEACHES} />
        <SplitCard title="Academy Director teaches" rates={DIRECTOR_TEACHES} note="Director takes coach + director lines (70%); PURE retains 30%." />
      </div>

      {/* Create offering / class */}
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">Create a class or clinic</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            A clinic/class with a capacity appears on the public <span className="font-medium">Clinics</span> page with a direct signup link.
            Add a DUPR band, gender, or age group to target it (e.g. a 4.0 men&apos;s class) and invite matching players. Make it multi-week to run a class series.
          </p>
        </div>
        <ClassBuilderForm
          ticket={ticket}
          facilities={alaFacilities.map((f) => ({ id: f.id, name: f.name }))}
          coaches={coaches.map((c) => ({ id: c.id, name: `${c.person.firstName} ${c.person.lastName}` }))}
        />
      </div>

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
              const hasTarget = o.targetMinRating != null || o.targetMaxRating != null || !!o.targetGender || !!o.targetAgeGroup;
              const targetLabel = hasTarget ? describeTarget(o) : null;
              const sessions = o.classSessions ?? [];
              return (
                <div key={o.id} className={`rounded-lg border p-3 ${o.active ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-70"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-slate-800">{o.title}</span>
                    <span className="whitespace-nowrap font-semibold text-brand-700">{formatCents(o.priceCents)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {TYPE_LABEL[o.type]}{sessions.length > 1 ? ` · ${sessions.length}-week class` : ""} · {o.facility?.name ?? "—"}{o.coach ? ` · ${o.coach.person.firstName} ${o.coach.person.lastName}` : ""}
                  </div>
                  {targetLabel && (
                    <div className="mt-1 inline-block rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">For: {targetLabel}</div>
                  )}
                  {sessions.length > 1 ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {sessions.length} sessions · {formatDateTime12(sessions[0].scheduledAt)} → {formatDateTime12(sessions[sessions.length - 1].scheduledAt)}
                    </div>
                  ) : o.scheduledAt ? (
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime12(o.scheduledAt)}</div>
                  ) : null}
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

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <form method="POST" action="/api/console/alacarte">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="toggleOffering" />
                      <input type="hidden" name="offeringId" value={o.id} />
                      <input type="hidden" name="active" value={o.active ? "0" : "1"} />
                      <button className="btn-chip-muted">{o.active ? "Deactivate" : "Reactivate"}</button>
                    </form>
                    {isClinic && hasTarget && (
                      <Link href={`/console/alacarte/${o.id}/invite`} className="btn-chip-brand text-xs">Invite matching players →</Link>
                    )}
                  </div>

                  {isClinic && (
                    <details className="mt-2 border-t border-slate-100 pt-2">
                      <summary className="btn-chip-muted inline-flex cursor-pointer list-none text-xs font-semibold [&::-webkit-details-marker]:hidden">Edit class</summary>
                      <div className="mt-2">
                        <ClassBuilderForm
                          ticket={ticket}
                          facilities={alaFacilities.map((f) => ({ id: f.id, name: f.name }))}
                          coaches={coaches.map((c) => ({ id: c.id, name: `${c.person.firstName} ${c.person.lastName}` }))}
                          offering={{
                            id: o.id, type: o.type, title: o.title, description: o.description,
                            facilityId: o.facilityId, coachId: o.coachId, priceCents: o.priceCents, capacity: o.capacity,
                            scheduledAt: toLocalInput(o.scheduledAt),
                            targetMinRating: o.targetMinRating, targetMaxRating: o.targetMaxRating,
                            targetGender: o.targetGender, targetAgeGroup: o.targetAgeGroup,
                            sessions: sessions.map((s) => toLocalInput(s.scheduledAt)),
                          }}
                        />
                      </div>
                    </details>
                  )}
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
                      <Link href={`/console/people/${b.client.id}`} className="hover:text-brand-700 hover:underline">{b.client.firstName} {b.client.lastName}</Link> · {b.offering.facility?.name ?? "—"}
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

                {/* A player-booked lesson (has a series) can be moved or cancelled
                    here — reschedule/relocate re-checks the court, cancel can refund. */}
                {b.seriesId && b.status !== "CANCELLED" && b.status !== "DECLINED" && (
                  <LessonManageControls
                    booking={{
                      id: b.id, scheduledAt: b.scheduledAt, facilityId: b.facilityId,
                      offeringTitle: b.offering.title, clientName: `${b.client.firstName} ${b.client.lastName}`.trim(),
                      coachName: b.coach ? `${b.coach.person.firstName} ${b.coach.person.lastName}` : null, status: b.status,
                    } as ManageBooking}
                    facilities={alaFacilities.map((f) => ({ id: f.id, name: f.name }))}
                    ticket={ticket}
                    returnTo="/console/alacarte"
                    isAdmin
                  />
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
