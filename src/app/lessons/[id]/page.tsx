import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PublicNav } from "@/components/PublicNav";
import { LessonBookingWizard } from "@/components/LessonBookingWizard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const coach = await prisma.coach.findFirst({ where: { personId: id }, select: { person: { select: { firstName: true, lastName: true } } } });
  const nm = coach ? `${coach.person.firstName} ${coach.person.lastName}`.trim() : null;
  return { title: nm ? `Book with ${nm} — PURE Academy` : "Book a lesson — PURE Academy" };
}

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
  const name = `${coach.person.firstName} ${coach.person.lastName}`.trim();

  const offerings = coach.alaCarteOfferings.map((o) => ({
    id: o.id, type: o.type, title: o.title, priceCents: o.priceCents, adminLockedPriceCents: o.adminLockedPriceCents,
    lengthMin: o.lengthMin, minPeople: o.minPeople, maxPeople: o.maxPeople, recurrenceAllowed: o.recurrenceAllowed,
    recurringDiscountPct: o.recurringDiscountPct, preferredFacilityIds: asIds(o.preferredFacilityIds),
  }));

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

        <LessonBookingWizard
          coachPersonId={id}
          offerings={offerings}
          facilities={facilities}
          initialError={sp.err ? decodeURIComponent(sp.err) : null}
        />
      </div>
    </div>
  );
}
