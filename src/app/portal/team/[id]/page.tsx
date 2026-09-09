import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatTime12, formatDate, formatSessionDay, phoenixDateInput } from "@/lib/time";

function AttBadge({ status }: { status: string }) {
  const tone =
    status === "PRESENT" ? "bg-emerald-100 text-emerald-800"
    : status === "ABSENT" ? "bg-rose-100 text-rose-800"
    : "bg-amber-100 text-amber-800";
  return <span className={`badge ${tone}`}>{status[0] + status.slice(1).toLowerCase()}</span>;
}

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

  // The player's own attendance record for this team — populated by the coach's
  // check-in on each session.
  const myMemberIds = team.members.filter((m) => household.includes(m.personId)).map((m) => m.personId);
  const attendance = myMemberIds.length
    ? await prisma.attendance.findMany({
        where: { personId: { in: myMemberIds }, session: { teams: { some: { teamId: team.id } } } },
        include: { session: { select: { date: true, weekNumber: true } } },
        orderBy: { session: { date: "desc" } },
      })
    : [];
  const attByPerson = new Map<string, typeof attendance>();
  for (const a of attendance) {
    const arr = attByPerson.get(a.personId) ?? [];
    arr.push(a);
    attByPerson.set(a.personId, arr);
  }
  const memberName = new Map(team.members.map((m) => [m.personId, `${m.person.firstName} ${m.person.lastName}`]));

  // Upcoming practices — the concrete dates, not just "Tuesdays". Fetch the
  // team's scheduled practices and keep today onward (session dates are a UTC
  // noon day anchor; compare on the Phoenix calendar day).
  const today = phoenixDateInput(new Date());
  const practices = await prisma.session.findMany({
    where: { teams: { some: { teamId: team.id } }, type: "PRACTICE", status: { in: ["SCHEDULED", "RESCHEDULED"] } },
    orderBy: { date: "asc" },
    include: { facility: { select: { name: true } } },
  });
  const upcoming = practices.filter((s) => phoenixDateInput(s.date) >= today).slice(0, 6);

  // What the coach has shared with the family — progress notes marked sent.
  const sharedNotes = myMemberIds.length
    ? await prisma.coachingNote.findMany({
        where: { teamId: team.id, personId: { in: myMemberIds }, sentToParentAt: { not: null }, note: { not: null } },
        orderBy: [{ week: "asc" }],
      })
    : [];

  const coach = team.coach?.person;
  const mapsQuery = team.facility?.exactAddress ?? [team.facility?.name, team.facility?.generalArea].filter(Boolean).join(" ");
  const mapsLink = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;
  const coachContact = [coach?.email, coach?.phone].filter(Boolean).join(" · ");
  const when = team.dayOfWeek
    ? `${team.dayOfWeek}${team.startTime ? ` at ${formatTime12(team.startTime)}` : ""}`
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
          {team.facility?.notes && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Good to know</dt>
              <dd className="text-right text-slate-600">{team.facility.notes}</dd>
            </div>
          )}
        </dl>
        {mapsLink && (
          <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            Get directions →
          </a>
        )}
      </section>

      {/* Upcoming practices — the real dates, so families can plan. */}
      {upcoming.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Upcoming practices</h2>
          <ul className="divide-y divide-slate-100">
            {upcoming.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{formatSessionDay(s.date, "long")}</span>
                <span className="text-slate-500">{formatTime12(s.startTime)}{s.facility?.name ? ` · ${s.facility.name}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Coach */}
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Coach</h2>
        {coach ? (
          <div className="flex items-start gap-4">
            {coach.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coach.imageUrl} alt={`${coach.firstName} ${coach.lastName}`} className="h-16 w-16 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
                {coach.firstName[0]}{coach.lastName[0]}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-medium text-slate-800">{coach.firstName} {coach.lastName}</div>
              {team.coach?.rpoCertLevel && <div className="text-xs text-slate-500">{team.coach.rpoCertLevel} certified</div>}
              {team.coach?.bio && <p className="mt-1 text-sm text-slate-600">{team.coach.bio}</p>}
              {coachContact && <div className="mt-1 text-sm text-slate-500">{coachContact}</div>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Your coach will be introduced soon.</p>
        )}
      </section>

      {/* From your coach — progress notes the coach has shared with the family. */}
      {sharedNotes.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">From your coach</h2>
          <ul className="space-y-3">
            {sharedNotes.map((n) => (
              <li key={n.id} className="border-l-2 border-brand-200 pl-3">
                <div className="text-xs font-medium text-slate-500">
                  {memberName.get(n.personId)} · Week {n.week}{n.sentToParentAt ? ` · ${formatDate(n.sentToParentAt)}` : ""}
                </div>
                <p className="mt-0.5 text-sm text-slate-700">{n.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Attendance — the player's record, set by the coach's session check-in */}
      {myMemberIds.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Attendance</h2>
          {myMemberIds.map((pid) => {
            const rows = attByPerson.get(pid) ?? [];
            const present = rows.filter((r) => r.status === "PRESENT").length;
            const absent = rows.filter((r) => r.status === "ABSENT").length;
            const excused = rows.filter((r) => r.status === "EXCUSED").length;
            return (
              <div key={pid} className="mb-5 last:mb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{memberName.get(pid)}</span>
                  {rows.length > 0 && (
                    <span className="text-xs text-slate-500">
                      {present} present · {absent} absent · {excused} excused
                    </span>
                  )}
                </div>
                {rows.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">No sessions recorded yet — your coach will check you in each session.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {rows.slice(0, 12).map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-slate-600">
                          {formatDate(r.session.date)}
                          {r.session.weekNumber ? ` · week ${r.session.weekNumber}` : ""}
                        </span>
                        <AttBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
                {rows.length > 12 && <p className="mt-1 text-xs text-slate-400">Showing the 12 most recent.</p>}
              </div>
            );
          })}
        </section>
      )}

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
