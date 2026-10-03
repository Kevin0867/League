import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12, formatDateTime12 } from "@/lib/time";
import { LessonAvailabilityForm } from "@/components/LessonAvailabilityForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private/Group lesson pricing" };

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private (1 player)", SEMI_PRIVATE: "Semi-private (2–3)", GROUP: "Group (4+)" };
function asIds(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }

export default async function LessonPricingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  const ticket = await mintConsoleTicket();
  const admin = isAdmin(session.roles ?? [session.role]);

  // Own setup, or (admins only) another coach's via ?coach=<personId>.
  const viewingOther = admin && !!sp.coach && sp.coach !== session.personId;
  if (sp.coach && sp.coach !== session.personId && !admin) redirect("/console/profile");
  const personId = viewingOther ? sp.coach! : session.personId ?? "";

  // Lesson setup is per-coach. An admin manages a COACH's setup, so when one lands
  // here without having picked a coach (e.g. their own admin login isn't a coach,
  // or isn't linked to a person at all), show a coach picker instead of erroring.
  if (admin && !viewingOther && !personId) {
    const coaches = await prisma.coach.findMany({
      select: { personId: true, person: { select: { firstName: true, lastName: true } } },
      orderBy: { person: { lastName: "asc" } },
    });
    return (
      <div className="space-y-6">
        <PageHeader title="Private/Group lesson pricing" subtitle="Pick a coach to set up their lesson offerings, pricing, and availability." />
        {sp.err === "pickcoach" && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Pick a coach first, then add their lesson — your admin login isn&apos;t itself a coach, so lessons attach to the coach you choose below.</p>}
        <div className="card">
          <h2 className="font-semibold text-slate-900">Choose a coach</h2>
          <p className="mt-0.5 text-sm text-slate-500">You&apos;re an admin, so pick whose lesson setup you want to manage. Coaches edit their own from their dashboard.</p>
          {coaches.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No coaches yet. Add coaches first, then set up their lessons.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {coaches.map((c) => (
                <Link key={c.personId} href={`/console/profile/lessons?coach=${c.personId}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-brand-300 hover:bg-brand-50">
                  <span className="font-medium text-slate-800">{c.person.firstName} {c.person.lastName}</span>
                  <span className="text-brand-700">Set up →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (!personId) redirect("/console/profile?err=noperson");

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      firstName: true, lastName: true,
      coach: {
        include: {
          availabilityBlocks: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
          availabilityExceptions: { orderBy: { date: "asc" } },
          alaCarteOfferings: { where: { coachSet: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!person) redirect("/console/profile?err=noperson");
  const coach = person.coach;
  const facilities = await prisma.facility.findMany({ where: { archived: false, alaCarteAllowed: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const facName = new Map(facilities.map((f) => [f.id, f.name]));

  const offerings = coach?.alaCarteOfferings ?? [];
  const exceptions = coach?.availabilityExceptions ?? [];

  // Phone-calendar busy-import status, so the coach can see it's working.
  const calSync = coach?.externalCalendarUrl
    ? await prisma.coachBusyBlock.aggregate({ where: { coachId: coach.id }, _count: { _all: true }, _max: { fetchedAt: true } })
    : null;

  const whose = viewingOther ? `${person.firstName} ${person.lastName}`.trim() : "your";
  const hidden = viewingOther ? <input type="hidden" name="personId" value={personId} /> : null;

  return (
    <div className="space-y-6">
      {viewingOther && (
        <Link href={`/console/coaches/${personId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">← Back to {person.firstName}&apos;s profile</Link>
      )}
      <PageHeader
        title="Private/Group lesson pricing"
        subtitle={viewingOther ? `Set up ${whose} lesson offerings, availability, and pricing. Changes are saved for this coach.` : "Set up every kind of lesson you offer, your price, and when you're available. Players book and pay through PURE, and your court is reserved automatically."}
      />

      {!viewingOther && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/console/profile/lessons/schedule" className="btn-ghost">View my upcoming booked lessons →</Link>
        </div>
      )}

      {sp.ok === "offering" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Offering saved.</p>}
      {sp.ok === "offeringdel" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Offering removed.</p>}
      {sp.ok === "availability" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Availability saved.</p>}
      {sp.ok === "exception" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Added to your calendar.</p>}
      {sp.ok === "exceptiondel" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Removed.</p>}
      {sp.err === "price" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Enter a price greater than $0.</p>}
      {sp.err === "length" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Enter a lesson length in minutes.</p>}
      {sp.err === "type" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Pick a lesson format.</p>}

      {/* 1 · Lesson offerings */}
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold text-slate-900">Your lesson offerings</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            One entry per kind of lesson you teach — e.g. a 60-min private, a 90-min semi-private for 2–3, a group clinic. Add as many as you need to cover every scenario.
          </p>
        </div>

        {offerings.length > 0 && (
          <ul className="space-y-3">
            {offerings.map((o) => (
              <li key={o.id} className="rounded-xl border border-slate-200 p-3">
                <OfferingForm ticket={ticket} hidden={hidden} offering={o} facilities={facilities} facName={facName} />
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-xl border border-dashed border-slate-300 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ Add a lesson offering</summary>
          <div className="mt-3">
            <OfferingForm ticket={ticket} hidden={hidden} facilities={facilities} facName={facName} />
          </div>
        </details>
      </div>

      {/* 2 · Availability + phone calendar */}
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">Availability</h2>
          <p className="mt-0.5 text-sm text-slate-500">The weekly windows you&apos;re open to teach lessons, plus an optional link to your phone calendar so busy times block automatically.</p>
        </div>
        <LessonAvailabilityForm
          ticket={ticket}
          personId={viewingOther ? personId : undefined}
          initialBlocks={(coach?.availabilityBlocks ?? []).map((b) => ({ dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime }))}
          initialCalendarUrl={coach?.externalCalendarUrl ?? ""}
        />
        {coach?.externalCalendarUrl && (
          <p className="text-xs text-slate-400">
            {calSync?._max.fetchedAt
              ? `Calendar last synced ${formatDateTime12(calSync._max.fetchedAt)} — ${calSync._count._all} busy time${calSync._count._all === 1 ? "" : "s"} imported and blocked from booking.`
              : "Your calendar link is saved — PURE refreshes it automatically every couple of hours to block your busy times."}
          </p>
        )}
      </div>

      {/* 3 · Time off / one-off availability */}
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">Time off &amp; one-off days</h2>
          <p className="mt-0.5 text-sm text-slate-500">Block a specific day/time you can&apos;t teach, or open up an extra slot outside your usual week.</p>
        </div>
        {exceptions.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-1.5">
                <span className="text-slate-700">
                  <span className={`badge ${e.kind === "OPEN" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{e.kind === "OPEN" ? "Extra" : "Off"}</span>
                  <span className="ml-2">{formatDate(e.date)}{e.startTime ? ` · ${formatTime12(e.startTime)}–${e.endTime ? formatTime12(e.endTime) : ""}` : " · all day"}</span>
                  {e.note ? <span className="ml-2 text-slate-400">{e.note}</span> : null}
                </span>
                <form method="POST" action="/api/console/lesson-offerings">
                  <input type="hidden" name="ticket" value={ticket} />{hidden}
                  <input type="hidden" name="op" value="deleteException" />
                  <input type="hidden" name="exceptionId" value={e.id} />
                  <button className="btn-chip-danger">remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form method="POST" action="/api/console/lesson-offerings" className="grid gap-2 sm:grid-cols-6 sm:items-end">
          <input type="hidden" name="ticket" value={ticket} />{hidden}
          <input type="hidden" name="op" value="addException" />
          <div className="sm:col-span-1">
            <label className="label">Type</label>
            <select name="kind" className="input py-1"><option value="BLOCK">Time off</option><option value="OPEN">Extra slot</option></select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Date</label>
            <input name="date" type="date" required className="input py-1" />
          </div>
          <div className="sm:col-span-1">
            <label className="label">From (opt)</label>
            <input name="startTime" type="time" className="input py-1" />
          </div>
          <div className="sm:col-span-1">
            <label className="label">To (opt)</label>
            <input name="endTime" type="time" className="input py-1" />
          </div>
          <div className="sm:col-span-1">
            <button className="btn-secondary w-full">Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// One offering's add/edit form (native POST). Reused for the "add" card and each
// existing row. PRIVATE forces 1 person; SEMI/GROUP take a min–max range.
function OfferingForm({
  ticket, hidden, offering, facilities, facName,
}: {
  ticket: string;
  hidden: React.ReactNode;
  offering?: { id: string; type: string; title: string; description: string | null; priceCents: number; lengthMin: number | null; minPeople: number | null; maxPeople: number | null; preferredFacilityIds: unknown; recurrenceAllowed: boolean; recurringDiscountPct: number | null; active: boolean };
  facilities: { id: string; name: string }[];
  facName: Map<string, string>;
}) {
  const pref = asIds(offering?.preferredFacilityIds);
  return (
    <div className="space-y-3">
      <form method="POST" action="/api/console/lesson-offerings" className="grid gap-3 sm:grid-cols-6">
        <input type="hidden" name="ticket" value={ticket} />{hidden}
        <input type="hidden" name="op" value="saveOffering" />
        {offering && <input type="hidden" name="offeringId" value={offering.id} />}
        <div className="sm:col-span-2">
          <label className="label">Format</label>
          <select name="type" defaultValue={offering?.type ?? "PRIVATE"} className="input py-1">
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className="label">Length (min)</label>
          <input name="lengthMin" type="number" min="15" step="15" defaultValue={offering?.lengthMin ?? 60} className="input py-1" />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Price / person ($)</label>
          <input name="price" type="number" min="0" step="0.01" defaultValue={offering ? (offering.priceCents / 100).toFixed(2) : ""} placeholder="80.00" className="input py-1" required />
        </div>
        <div className="sm:col-span-1">
          <label className="label"># people (min)</label>
          <input name="minPeople" type="number" min="1" defaultValue={offering?.minPeople ?? 1} className="input py-1" />
        </div>
        <div className="sm:col-span-1">
          <label className="label"># people (max)</label>
          <input name="maxPeople" type="number" min="1" defaultValue={offering?.maxPeople ?? 1} className="input py-1" />
        </div>
        <div className="sm:col-span-6">
          <label className="label">Title / note (optional)</label>
          <input name="title" defaultValue={offering?.title ?? ""} placeholder="e.g. 60-min private — all levels" className="input py-1" />
        </div>
        {facilities.length > 0 && (
          <div className="sm:col-span-6">
            <label className="label">Preferred locations</label>
            <div className="flex flex-wrap gap-3">
              {facilities.map((f) => (
                <label key={f.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="facility" value={f.id} defaultChecked={pref.includes(f.id)} /> {f.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <p className="sm:col-span-6 -mt-1 text-xs text-slate-500">
          <strong>Price is per person.</strong> For a semi-private or group lesson, each player pays this amount (e.g. $40/person × 3 players = $120 for the lesson).
        </p>
        <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="recurrenceAllowed" defaultChecked={offering ? offering.recurrenceAllowed : true} /> Allow recurring bookings (weekly/monthly series)
        </label>
        <div className="sm:col-span-2">
          <label className="label">Recurring discount (%)</label>
          <input name="recurringDiscountPct" type="number" min="0" max="90" step="1" defaultValue={offering?.recurringDiscountPct ?? ""} placeholder="0" className="input py-1" />
        </div>
        <div className="sm:col-span-1" />
        <p className="sm:col-span-6 -mt-1 text-xs text-slate-500">
          Optional: take this % off each lesson&apos;s per-person price when a player commits to a recurring series — a built-in incentive to book a block. Leave blank or 0 for no discount.
        </p>
        <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="active" defaultChecked={offering ? offering.active : true} /> Bookable
        </label>
        <div className="sm:col-span-3 flex items-end justify-end">
          <button className="btn-primary py-1 text-sm">{offering ? "Save" : "Add offering"}</button>
        </div>
      </form>
      {offering && (
        <form method="POST" action="/api/console/lesson-offerings" className="text-right">
          <input type="hidden" name="ticket" value={ticket} />{hidden}
          <input type="hidden" name="op" value="deleteOffering" />
          <input type="hidden" name="offeringId" value={offering.id} />
          <button className="text-xs text-rose-600 hover:underline">Remove this offering</button>
        </form>
      )}
    </div>
  );
}
