import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  const session = await requireUser();

  // The logged-in adult, plus any dependents they manage.
  const me = session.personId
    ? await prisma.person.findUnique({
        where: { id: session.personId },
        include: { dependents: true },
      })
    : null;

  const peopleIds = [
    ...(me ? [me.id] : []),
    ...(me?.dependents.map((d) => d.id) ?? []),
  ];

  const registrations = peopleIds.length
    ? await prisma.registration.findMany({
        where: { personId: { in: peopleIds } },
        include: {
          person: true,
          division: true,
        },
        orderBy: { submittedAt: "desc" },
      })
    : [];

  const memberships = peopleIds.length
    ? await prisma.teamMember.findMany({
        where: { personId: { in: peopleIds } },
        include: {
          team: { include: { coach: { include: { person: true } }, facility: true } },
          person: true,
        },
      })
    : [];

  const payments = peopleIds.length
    ? await prisma.payment.findMany({
        where: { partyId: { in: peopleIds }, direction: "IN" },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const waiverOutstanding = me && !me.waiverSignedAt;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {session.name.split(" ")[0]}</h1>
        <p className="text-slate-500">Your season at a glance.</p>
      </div>

      {waiverOutstanding && (
        <div className="card border-l-4 border-amber-400">
          <p className="text-sm font-medium text-amber-800">Waiver outstanding</p>
          <p className="mt-1 text-sm text-slate-600">
            A signed waiver is required before appearing on a court-ready roster.
          </p>
        </div>
      )}

      {/* Placement / registration status */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Registrations</h2>
        <div className="space-y-3">
          {registrations.length === 0 && (
            <div className="card text-sm text-slate-500">
              No registrations yet.{" "}
              <Link href="/register" className="font-medium text-brand-700">Register for the season →</Link>
            </div>
          )}
          {registrations.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{r.person.firstName} {r.person.lastName}</div>
                  <div className="text-sm text-slate-500">
                    {r.division?.name ?? "Awaiting placement"}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.status !== "ASSIGNED" && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  You&apos;ll be placed on a team after the Week-1 assessment. We&apos;ll notify
                  you with your team, coach, location, day, and time — then request payment.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Teams */}
      {memberships.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">My teams</h2>
          <div className="space-y-3">
            {memberships.map((m) => (
              <div key={m.id} className="card">
                <div className="font-semibold text-slate-800">{m.team.name}</div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <div><dt className="text-xs text-slate-400">Coach</dt><dd>{m.team.coach ? `${m.team.coach.person.firstName} ${m.team.coach.person.lastName}` : "TBA"}</dd></div>
                  <div><dt className="text-xs text-slate-400">Location</dt><dd>{m.team.facility?.name ?? "TBA"}</dd></div>
                  <div><dt className="text-xs text-slate-400">Day / time</dt><dd>{m.team.dayOfWeek ?? "TBA"} {m.team.startTime ?? ""}</dd></div>
                  <div><dt className="text-xs text-slate-400">Player</dt><dd>{m.person.firstName}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Payments */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Payments</h2>
        <div className="space-y-3">
          {payments.length === 0 ? (
            <div className="card text-sm text-slate-500">No payments requested yet.</div>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="card flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800">{formatCents(p.amountCents)}</div>
                  <div className="text-xs text-slate-400">{p.description ?? p.category.replace(/_/g, " ")}</div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={p.status} />
                  {(p.status === "REQUESTED" || p.status === "PENDING") && (
                    <button className="btn-primary" disabled title="Stripe checkout — Phase 1 payments">Pay now</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
