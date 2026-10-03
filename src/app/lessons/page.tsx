import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { PublicNav } from "@/components/PublicNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a lesson — PURE Academy" };

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private", SEMI_PRIVATE: "Semi-private", GROUP: "Group" };

export default async function LessonsHomePage() {
  const coaches = await prisma.coach.findMany({
    where: { alaCarteOfferings: { some: { coachSet: true, active: true } } },
    select: {
      id: true, bio: true,
      person: { select: { id: true, firstName: true, lastName: true, imageUrl: true } },
      alaCarteOfferings: { where: { coachSet: true, active: true }, select: { type: true, priceCents: true, adminLockedPriceCents: true, lengthMin: true }, orderBy: { priceCents: "asc" } },
    },
    orderBy: { person: { lastName: "asc" } },
  });

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">Book a lesson</h1>
      <p className="mt-2 text-slate-600">Pick a coach, choose a time that works, and pay securely — all through PURE. Private, semi-private, and group lessons.</p>

      {coaches.length === 0 ? (
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">No coaches are offering lessons just yet — check back soon.</div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {coaches.map((c) => {
            const from = Math.min(...c.alaCarteOfferings.map((o) => o.adminLockedPriceCents ?? o.priceCents));
            const types = [...new Set(c.alaCarteOfferings.map((o) => TYPE_LABEL[o.type] ?? o.type))];
            return (
              <Link key={c.id} href={`/lessons/${c.person.id}`} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow">
                {c.person.imageUrl
                  ? <img src={c.person.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                  : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-brand-100 text-2xl font-bold text-brand-700">{c.person.firstName[0]}{c.person.lastName[0]}</div>}
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-900">{c.person.firstName} {c.person.lastName}</h2>
                  <p className="text-sm text-slate-500">{types.join(" · ")}</p>
                  {c.bio && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{c.bio}</p>}
                  <p className="mt-2 text-sm font-semibold text-brand-700">From {formatCents(from)} · Book →</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
