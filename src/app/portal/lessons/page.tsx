import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";
import { bookOffering } from "../actions";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { PRIVATE: "Private", SEMI_PRIVATE: "Semi-private", CLINIC: "Clinic" };

export default async function LessonsPage() {
  const session = await requireUser();
  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId }, include: { dependents: true } })
    : null;
  const household = [...(me ? [me] : []), ...(me?.dependents ?? [])];
  const householdIds = household.map((p) => p.id);

  const [offerings, bookings] = await Promise.all([
    prisma.alaCarteOffering.findMany({
      where: { active: true, facility: { alaCarteAllowed: true } },
      include: { facility: true, coach: { include: { person: true } } },
      orderBy: { createdAt: "desc" },
    }),
    householdIds.length
      ? prisma.alaCarteBooking.findMany({
          where: { clientId: { in: householdIds } },
          include: { offering: true, coach: { include: { person: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lessons & clinics</h1>
          <p className="text-slate-500">Book a private lesson, semi-private session, or clinic.</p>
        </div>
        <Link href="/portal" className="btn-ghost text-sm">← Portal</Link>
      </div>

      {bookings.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">My bookings</h2>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="card flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800">{b.offering.title}</div>
                  <div className="text-xs text-slate-400">
                    {b.coach ? `${b.coach.person.firstName} ${b.coach.person.lastName}` : "coach TBA"}
                    {b.status === "DELIVERED" ? " · completed" : ""}
                  </div>
                </div>
                <StatusBadge status={b.status} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Catalog</h2>
        {offerings.length === 0 ? (
          <div className="card text-sm text-slate-500">No lessons available right now. Check back soon.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {offerings.map((o) => (
              <div key={o.id} className="card">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{o.title}</span>
                  <span className="font-semibold text-brand-700">{formatCents(o.priceCents)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {TYPE_LABEL[o.type]} · {o.facility.name}{o.coach ? ` · ${o.coach.person.firstName} ${o.coach.person.lastName}` : ""}
                </div>
                <form action={bookOffering} className="mt-3 flex gap-2">
                  <input type="hidden" name="offeringId" value={o.id} />
                  {household.length > 1 ? (
                    <select name="clientId" className="input py-1 text-sm">
                      {household.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                    </select>
                  ) : (
                    <input type="hidden" name="clientId" value={householdIds[0] ?? ""} />
                  )}
                  <button className="btn-primary text-sm whitespace-nowrap">Request booking</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
