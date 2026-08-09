import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();

  const me = session.personId
    ? await prisma.person.findUnique({
        where: { id: session.personId },
        include: { dependents: { select: { id: true } } },
      })
    : null;
  const household = me ? [me.id, ...me.dependents.map((d) => d.id)] : [];

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      season: true,
      division: true,
      facility: true,
      coach: { include: { person: true } },
      members: { include: { person: true }, orderBy: { joinedAt: "asc" } },
    },
  });

  const isOnTeam = team?.members.some((m) => household.includes(m.personId));
  if (!team || !isOnTeam) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">Team not found</h1>
        <p className="mt-2 text-slate-500">This team isn&apos;t on your account.</p>
        <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
      </div>
    );
  }

  const coach = team.coach?.person;
  const coachContact = [coach?.email, coach?.phone].filter(Boolean).join(" · ");
  const when = team.dayOfWeek
    ? `${team.dayOfWeek}${team.startTime ? ` at ${team.startTime}` : ""}`
    : "A day and time to be confirmed";
  const address = team.facility?.exactAddress ?? team.facility?.generalArea ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
            {team.season?.name ?? "PURE Academy"}
          </p>
          <h1 className="text-2xl font-bold text-slate-900">{team.name}</h1>
          {(team.division?.name || team.levelBand) && (
            <p className="text-sm text-slate-500">{team.division?.name ?? team.levelBand}</p>
          )}
        </div>
        <Link href="/portal" className="btn-ghost text-sm">← Portal</Link>
      </div>

      {/* Practice & location */}
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Practice</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">When</dt>
            <dd className="text-right font-medium text-slate-800">{when}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Location</dt>
            <dd className="text-right font-medium text-slate-800">{team.facility?.name ?? "To be confirmed"}</dd>
          </div>
          {address && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Address</dt>
              <dd className="text-right font-medium text-slate-800">{address}</dd>
            </div>
          )}
          {team.facility?.accessInstructions && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Access</dt>
              <dd className="text-right text-slate-600">{team.facility.accessInstructions}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Coach */}
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Coach</h2>
        {coach ? (
          <div>
            <div className="font-medium text-slate-800">
              {coach.firstName} {coach.lastName}
            </div>
            {team.coach?.rpoCertLevel && (
              <div className="text-xs text-slate-400">{team.coach.rpoCertLevel} certified</div>
            )}
            {coachContact && <div className="mt-1 text-sm text-slate-500">{coachContact}</div>}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Your coach will be introduced soon.</p>
        )}
      </section>

      {/* Teammates */}
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Teammates ({team.members.length})
        </h2>
        <ul className="divide-y divide-slate-100">
          {team.members.map((m) => {
            const mine = household.includes(m.personId);
            return (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {m.person.firstName} {m.person.lastName}
                  {mine && <span className="ml-2 text-xs font-normal text-brand-600">(you)</span>}
                </span>
                {m.roleOnTeam && m.roleOnTeam !== "PLAYER" && (
                  <span className="text-xs text-slate-400">{m.roleOnTeam.replace(/_/g, " ").toLowerCase()}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
