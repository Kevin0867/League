import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12, formatDateTime12 } from "@/lib/time";
import { LessonAvailabilityForm } from "@/components/LessonAvailabilityForm";
import { OfferingForm } from "@/components/OfferingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private/Group lesson pricing" };

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private (1 player)", SEMI_PRIVATE: "Semi-private (2–3)", GROUP: "Group (4+)" };

// Inline validation messages for the lesson-offerings route's rejections.
const LESSON_ERRORS: Record<string, string> = {
  type: "Pick a lesson format.",
  price: "Enter a price greater than $0.",
  length: "Lesson length must be in 15-minute blocks, between 15 minutes and 4 hours.",
  people: "Enter the minimum and maximum number of players.",
  peoplemin: "A semi-private or group lesson needs at least 2 players.",
  peopleorder: "Maximum players can't be less than the minimum.",
  peoplemax: "That's more players than a lesson can hold (max 20).",
  discount: "Recurring discount must be a whole number between 0 and 90%.",
  availnone: "Add at least one availability window before saving (use Time off to block specific days).",
  availorder: "Each availability window's end time must be after its start time.",
  availoverlap: "You have overlapping availability windows on the same day — merge them into one.",
  calurl: "That calendar link isn't a valid URL. It should start with https:// or webcal://.",
  date: "Pick a valid date.",
  exppast: "That date is in the past.",
  exptimes: "An extra-availability slot needs both a start and end time.",
  exporder: "End time must be after start time.",
  expdup: "You already have an entry for that day — edit or remove it first.",
  pickcoach: "Pick a coach first, then add their lesson.",
};
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
                  <span className="btn-chip-brand">Set up</span>
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
      {sp.err && LESSON_ERRORS[sp.err] && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{LESSON_ERRORS[sp.err]}</p>}

      {/* 1 · Lesson offerings */}
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold text-slate-900">Your lesson offerings</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            One entry per kind of lesson you teach — e.g. a 60-min private, a 90-min semi-private for 2–3, a group clinic. Add as many as you need to cover every scenario.
          </p>
        </div>

        {offerings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">No lesson offerings saved yet. Add your first one below — it&apos;ll appear here, and players can book it.</p>
        ) : (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Saved offerings ({offerings.length})</p>
            <ul className="space-y-2">
              {offerings.map((o) => {
                const perPerson = o.adminLockedPriceCents ?? o.priceCents;
                const people = o.type === "PRIVATE" ? "1 player" : `${o.minPeople ?? 1}–${o.maxPeople ?? o.minPeople ?? 1} players`;
                const locIds = asIds(o.preferredFacilityIds);
                const locs = locIds.length ? locIds.map((fid) => facName.get(fid)).filter(Boolean).join(", ") : "any lesson venue";
                return (
                  <li key={o.id} className={`rounded-xl border ${o.active ? "border-slate-200" : "border-slate-200 bg-slate-50"}`}>
                    <div className="px-3 pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{o.title || TYPE_LABEL[o.type]}</span>
                        <span className="font-bold text-brand-700">{formatCents(perPerson)}<span className="text-xs font-normal text-slate-400">/person</span></span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {TYPE_LABEL[o.type]} · {o.lengthMin ?? 60} min · {people}
                        {o.recurrenceAllowed ? (o.recurringDiscountPct ? ` · recurring (−${o.recurringDiscountPct}%)` : " · recurring OK") : " · single only"}
                        {!o.active && " · not bookable"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">Locations: {locs}</p>
                    </div>
                    <details className="mt-2 border-t border-slate-100">
                      <summary className="btn-chip-muted m-3 inline-flex cursor-pointer list-none text-xs font-semibold [&::-webkit-details-marker]:hidden">Edit</summary>
                      <div className="px-3 pb-3">
                        <OfferingForm ticket={ticket} personId={viewingOther ? personId : undefined} offering={o} facilities={facilities} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <details>
          <summary className="btn-primary inline-flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">+ Add a lesson offering</summary>
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <OfferingForm ticket={ticket} personId={viewingOther ? personId : undefined} facilities={facilities} />
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

