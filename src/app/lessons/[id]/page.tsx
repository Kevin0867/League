import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate, formatTime12, phoenixDateInput } from "@/lib/time";
import { openLessonSlots } from "@/lib/domain/lessonSlots";
import { PublicNav } from "@/components/PublicNav";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private (1 player)", SEMI_PRIVATE: "Semi-private (2–3)", GROUP: "Group (4+)" };
function asIds(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }

export default async function BookCoachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;

  const coach = await prisma.coach.findFirst({
    where: { personId: id, alaCarteOfferings: { some: { coachSet: true, active: true } } },
    select: {
      id: true, bio: true,
      person: { select: { id: true, firstName: true, lastName: true, imageUrl: true } },
      alaCarteOfferings: { where: { coachSet: true, active: true }, orderBy: { priceCents: "asc" } },
    },
  });
  if (!coach) notFound();

  const facilities = await prisma.facility.findMany({ where: { archived: false, alaCarteAllowed: true }, select: { id: true, name: true, generalArea: true }, orderBy: { name: "asc" } });
  const facName = new Map(facilities.map((f) => [f.id, f.name]));
  const offerings = coach.alaCarteOfferings;
  const name = `${coach.person.firstName} ${coach.person.lastName}`.trim();

  const offering = sp.offering ? offerings.find((o) => o.id === sp.offering) : null;
  // priceCents is PER PERSON; the lesson total is per-person × #players (× any
  // recurring discount), charged at checkout.
  const perPerson = offering ? (offering.adminLockedPriceCents ?? offering.priceCents) : 0;
  const discountPct = offering?.recurringDiscountPct && offering.recurrenceAllowed ? Math.min(90, Math.max(0, offering.recurringDiscountPct)) : 0;
  // Location options = the offering's preferred venues, else every lesson venue.
  const locOptions = offering ? (() => { const pref = asIds(offering.preferredFacilityIds); const ids = pref.length ? pref : facilities.map((f) => f.id); return facilities.filter((f) => ids.includes(f.id)); })() : [];
  const loc = sp.loc && locOptions.some((f) => f.id === sp.loc) ? sp.loc : "";

  // Compute open slots once offering + location are chosen.
  let slotsByDay: Map<string, string[]> | null = null;
  if (offering?.lengthMin && loc) {
    const from = phoenixDateInput(new Date());
    const toD = new Date(); toD.setUTCDate(toD.getUTCDate() + 21);
    const slots = await openLessonSlots({ coachId: coach.id, facilityId: loc, lengthMin: offering.lengthMin, fromDay: from, toDay: phoenixDateInput(toD), maxSlots: 60 });
    slotsByDay = new Map();
    for (const s of slots) { const a = slotsByDay.get(s.day) ?? []; a.push(s.startTime); slotsByDay.set(s.day, a); }
  }

  const errMsg = sp.err ? decodeURIComponent(sp.err) : null;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/lessons" className="text-sm font-medium text-brand-700 hover:underline">← All coaches</Link>

      <div className="mt-3 flex items-center gap-4">
        {coach.person.imageUrl
          ? <img src={coach.person.imageUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
          : <div className="grid h-16 w-16 place-items-center rounded-xl bg-brand-100 text-xl font-bold text-brand-700">{coach.person.firstName[0]}{coach.person.lastName[0]}</div>}
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Book with {name}</h1>
          {coach.bio && <p className="text-sm text-slate-500">{coach.bio}</p>}
        </div>
      </div>

      {errMsg && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{errMsg}</p>}

      {/* Step 1 — choose the lesson */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">1 · Choose your lesson</h2>
        <div className="mt-2 grid gap-2">
          {offerings.map((o) => {
            const p = o.adminLockedPriceCents ?? o.priceCents;
            const selected = offering?.id === o.id;
            return (
              <Link key={o.id} href={`/lessons/${id}?offering=${o.id}`} className={`flex items-center justify-between rounded-xl border p-3 ${selected ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"}`}>
                <span>
                  <span className="font-semibold text-slate-900">{o.title || TYPE_LABEL[o.type]}</span>
                  <span className="ml-2 text-xs text-slate-500">{TYPE_LABEL[o.type]} · {o.lengthMin ?? 60} min{o.recurrenceAllowed ? " · recurring OK" : ""}{o.recurringDiscountPct && o.recurrenceAllowed ? ` · ${o.recurringDiscountPct}% off recurring` : ""}</span>
                </span>
                <span className="text-right"><span className="font-bold text-brand-700">{formatCents(p)}</span><span className="block text-[11px] font-normal text-slate-400">per person</span></span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Step 2 — choose a location */}
      {offering && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">2 · Choose a location</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {locOptions.map((f) => (
              <Link key={f.id} href={`/lessons/${id}?offering=${offering.id}&loc=${f.id}`} className={`rounded-xl border px-3 py-2 text-sm ${loc === f.id ? "border-brand-500 bg-brand-50 font-semibold text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"}`}>
                {f.name}{f.generalArea ? <span className="ml-1 text-xs text-slate-400">· {f.generalArea}</span> : null}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Step 3 — pick a time + details */}
      {offering && loc && slotsByDay && (
        slotsByDay.size === 0 ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No open times at {facName.get(loc)} in the next 3 weeks. Try another location, or check back soon.</p>
        ) : (
          <form method="POST" action="/api/lessons/book" className="mt-6 space-y-5">
            <input type="hidden" name="coachPersonId" value={id} />
            <input type="hidden" name="offeringId" value={offering.id} />
            <input type="hidden" name="facilityId" value={loc} />

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">3 · Pick a time</h2>
              <div className="mt-2 space-y-3">
                {[...slotsByDay.entries()].map(([day, times]) => (
                  <div key={day}>
                    <p className="text-xs font-semibold text-slate-500">{formatDate(new Date(`${day}T12:00:00Z`))}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {times.map((t) => (
                        <label key={t} className="cursor-pointer">
                          <input type="radio" name="slot" value={`${day}|${t}`} required className="peer sr-only" />
                          <span className="inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 peer-checked:border-brand-500 peer-checked:bg-brand-600 peer-checked:text-white">{formatTime12(t)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {offering.type !== "PRIVATE" && (offering.maxPeople ?? 1) > 1 && (
              <div>
                <label className="label">How many players?</label>
                <input name="people" type="number" min={offering.minPeople ?? 2} max={offering.maxPeople ?? 4} defaultValue={offering.minPeople ?? 2} className="input w-28" />
                <p className="mt-1 text-xs text-slate-500">{formatCents(perPerson)} per person — the total is per person × players.</p>
              </div>
            )}

            {offering.recurrenceAllowed && (
              <details className="rounded-xl border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">Make this a recurring lesson</summary>
                <div className="mt-3 space-y-3">
                  <input type="hidden" name="recurring" value="on" />
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="label">Repeats</label>
                      <select name="cadence" className="input py-1"><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select>
                    </div>
                    <div>
                      <label className="label">End</label>
                      <select name="endType" className="input py-1"><option value="COUNT">After N lessons</option><option value="UNTIL_DATE">Until a date</option></select>
                    </div>
                    <div>
                      <label className="label"># of lessons</label>
                      <input name="count" type="number" min="2" max="52" defaultValue="5" className="input py-1 w-24" />
                    </div>
                    <div>
                      <label className="label">or until</label>
                      <input name="endDate" type="date" className="input py-1" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">We book the same time each week/month where the coach and a court are free. You pay per lesson — the first now, the rest before each session. (Leave this closed for a single lesson.)</p>
                  {discountPct > 0 && <p className="text-xs font-semibold text-emerald-700">Recurring saves {discountPct}% off each lesson.</p>}
                </div>
              </details>
            )}

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">4 · Your details</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div><label className="label">First name</label><input name="firstName" required className="input" /></div>
                <div><label className="label">Last name</label><input name="lastName" required className="input" /></div>
                <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
                <div><label className="label">Mobile</label><input name="phone" type="tel" className="input" /></div>
              </div>
            </div>

            <button type="submit" className="w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white hover:bg-brand-700">
              Continue to payment — {formatCents(perPerson)}/person
            </button>
            <p className="text-center text-xs text-slate-400">You&apos;ll pay for your first lesson on the next screen — {formatCents(perPerson)} per person{discountPct > 0 ? `, less ${discountPct}% for a recurring series` : ""}. Your court is reserved the moment you book.</p>
          </form>
        )
      )}
      </div>
    </div>
  );
}
