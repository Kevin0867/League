import Link from "next/link";
import { prisma } from "@/lib/db";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { formatCents } from "@/lib/money";
import { activeBookingCount, formatClinicWhen } from "@/lib/domain/clinics";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  fields: "Please fill in your name and email so we can send your confirmation.",
  full: "Sorry — this clinic just filled up.",
  closed: "Registration for this clinic is closed.",
};

export default async function ClinicSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { id } = await params;
  const { err } = await searchParams;

  const offering = await prisma.alaCarteOffering.findUnique({
    where: { id },
    include: { facility: true, coach: { include: { person: true } } },
  });

  const isClinic = offering && offering.type === "CLINIC" && offering.active && offering.capacity != null;
  const isPast = offering?.scheduledAt ? offering.scheduledAt.getTime() < Date.now() : false;

  if (!offering || !isClinic || isPast) {
    return (
      <div>
        <PublicNav />
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Clinic not available</h1>
          <p className="mt-3 text-slate-500">
            This clinic isn&apos;t open for signup. See <Link href="/clinics" className="text-brand-600 underline">all clinics</Link>.
          </p>
        </div>
      </div>
    );
  }

  const taken = await activeBookingCount(offering.id);
  const spotsLeft = Math.max(0, (offering.capacity ?? 0) - taken);
  const coachName = offering.coach ? `${offering.coach.person.firstName} ${offering.coach.person.lastName}` : null;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-lg px-4 py-12">
        <Link href="/clinics" className="text-sm text-slate-500 hover:underline">← All clinics</Link>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{offering.title}</h1>
            <span className="whitespace-nowrap rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">
              {formatCents(offering.priceCents)}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-700">{formatClinicWhen(offering.scheduledAt)}</p>
          <p className="text-sm text-slate-500">{offering.facility.name}{coachName ? ` · Coach ${coachName}` : ""}</p>
          {offering.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{offering.description}</p>}

          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className={spotsLeft === 0 ? "font-semibold text-rose-600" : "font-medium text-emerald-700"}>
              {spotsLeft === 0 ? "This clinic is full" : `${spotsLeft} of ${offering.capacity} spots left`}
            </span>
          </div>

          {err && ERRORS[err] && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[err]}</p>
          )}

          {spotsLeft === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-500">
              Sorry, this clinic is sold out. <Link href="/clinics" className="text-brand-600 underline">See other clinics</Link>.
            </p>
          ) : (
            <form method="POST" action="/api/clinics/signup" className="mt-6 space-y-4">
              <input type="hidden" name="offeringId" value={offering.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Participant first name</label>
                  <input name="firstName" className="input" required />
                </div>
                <div>
                  <label className="label">Participant last name</label>
                  <input name="lastName" className="input" required />
                </div>
              </div>
              <div>
                <label className="label">Email <span className="font-normal text-slate-400">(for your confirmation &amp; receipt)</span></label>
                <input name="email" type="email" className="input" required />
              </div>
              <div>
                <label className="label">Phone <span className="font-normal text-slate-400">(optional)</span></label>
                <input name="phone" type="tel" className="input" />
              </div>
              <button className="btn-primary w-full py-3">Reserve &amp; pay {formatCents(offering.priceCents)}</button>
              <p className="text-center text-xs text-slate-400">
                Secure checkout hosted by Stripe — no account required. Your spot is held once payment clears.
              </p>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Questions? Contact us at <a href={`mailto:${SUPPORT_ADDRESS}`} className="text-brand-600 underline">{SUPPORT_ADDRESS}</a>.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
