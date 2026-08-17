import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { coachAssignmentGate } from "@/lib/domain/teams";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can, requireAdmin } from "@/lib/rbac";
import { StaffForm } from "./StaffForm";
import { TableFilter } from "@/components/TableFilter";
import { LoginStatus } from "@/components/LoginStatus";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";

function parseMarkets(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const ERRORS: Record<string, string> = {
  auth: "Not authorized to create accounts.",
  fields: "All fields are required.",
  short: "Password must be at least 8 characters.",
  mismatch: "Passwords don't match.",
  role: "Invalid role.",
  exists: "A user with that email already exists.",
  op: "Unknown operation.",
  notfound: "Coach not found.",
  removefail: "Couldn't remove the coach. Try again, or unassign them from their teams first.",
};

export default async function CoachesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  // Auth enforced by the console layout; read the session only to gate the form.
  const session = await getSession();
  const ticket = await mintConsoleTicket();
  // The list is the UNION of (a) everyone with a COACH login — so a newly-added
  // coach shows even before a Coach profile exists — and (b) everyone who has a
  // Coach profile, regardless of their login role. That second set is why the
  // Director (a published Coach who may not hold a COACH login) appears here so
  // their photo and record can be managed.
  const coachInclude = {
    _count: { select: { teams: true, recruits: true } },
    availabilityBlocks: { select: { id: true } },
  } as const;
  const [coachUsers, coachProfiles] = await Promise.all([
    prisma.user.findMany({
      where: { role: "COACH" },
      include: { person: { include: { coach: { include: coachInclude } } } },
      orderBy: { person: { lastName: "asc" } },
    }),
    prisma.coach.findMany({
      include: { person: true, ...coachInclude },
      orderBy: { person: { lastName: "asc" } },
    }),
  ]);

  // Coach relation shape shared by both sources (the profile source carries an
  // extra `person`, which is structurally assignable to this smaller type).
  type CoachRel = NonNullable<(typeof coachUsers)[number]["person"]>["coach"];
  const byPerson = new Map<string, { person: { id: string; firstName: string; lastName: string; waiverSignedAt: Date | null }; coach: CoachRel }>();
  for (const u of coachUsers) if (u.person) byPerson.set(u.person.id, { person: u.person, coach: u.person.coach });
  for (const c of coachProfiles) if (!byPerson.has(c.personId)) byPerson.set(c.personId, { person: c.person, coach: c });
  const coaches = [...byPerson.values()].sort((a, b) =>
    `${a.person.lastName} ${a.person.firstName}`.localeCompare(`${b.person.lastName} ${b.person.firstName}`)
  );

  // Login activity per coach: whether they hold an account and when they last
  // signed in — the definitive answer to "was the coach able to log on yet?".
  const accountRows = await prisma.user.findMany({
    where: { personId: { in: [...byPerson.keys()] } },
    select: { personId: true, lastLoginAt: true, active: true },
  });
  const accountByPerson = new Map(accountRows.map((a) => [a.personId as string, a]));

  // Availability completeness — a coach only shows up as a location/day match in
  // Coach matching once they've set both locations and day/time blocks.
  const availabilityOf = (coach: (typeof coaches)[number]["coach"]) => {
    const hasLocations = parseMarkets(coach?.marketsCovered ?? null).length > 0;
    const hasDayTimes = (coach?.availabilityBlocks?.length ?? 0) > 0;
    const missing = [!hasLocations && "locations", !hasDayTimes && "day/time"].filter(Boolean) as string[];
    return { complete: missing.length === 0, missing };
  };
  const incompleteCount = coaches.filter((c) => c.coach && !availabilityOf(c.coach).complete).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Coaches" subtitle="Screening gate, recruitment credit, and assignments." />
      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sp.ok === "profile" ? "Coach profile updated." : sp.ok === "publish" ? "Public site visibility updated." : sp.ok === "waiverSent" ? "Waiver request sent to the coach." : sp.ok === "removed" ? "Coach removed." : "Account created."}
        </p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>
      )}
      {session && can(session.role, "manageCoaches") && <StaffForm role={session.role} ticket={ticket} />}

      {incompleteCount > 0 && (
        <div className="card border-l-4 border-amber-400">
          <p className="text-sm font-medium text-amber-800">
            {incompleteCount} coach{incompleteCount === 1 ? "" : "es"} haven&apos;t finished their availability
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Coaches only appear as location/day matches in{" "}
            <Link href="/console/matching" className="text-brand-700 hover:underline">Coach matching</Link>{" "}
            once they&apos;ve set both their locations and day/time availability. Ask them to complete their
            profile, or click a coach&apos;s name to open and fill in their record.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md flex-1">
          <TableFilter targetId="coaches-table" placeholder="Search coaches by name…" />
        </div>
        {session && can(session.role, "manageCoaches") && (
          <div className="flex gap-2">
            <form method="POST" action="/api/console/coaches">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="publishAll" />
              <input type="hidden" name="returnTo" value="/console/coaches" />
              <button className="btn-secondary text-sm">Publish all to site</button>
            </form>
            <form method="POST" action="/api/console/coaches">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="hideAll" />
              <input type="hidden" name="returnTo" value="/console/coaches" />
              <button className="text-sm text-slate-500 hover:text-rose-600 hover:underline">Hide all</button>
            </form>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table id="coaches-table" className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Coach</th>
              <th>Public site</th>
              <th className="hidden lg:table-cell">Cert</th>
              <th className="hidden sm:table-cell">Screening</th>
              <th>Login</th>
              <th>Waiver</th>
              <th>Availability</th>
              <th className="hidden md:table-cell">Teams</th>
              <th className="hidden lg:table-cell">Recruited</th>
              <th className="text-right">Manage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {coaches.map(({ person, coach }) => {
              const gate = coach ? coachAssignmentGate(coach) : { ok: false, reasons: ["no profile yet"] };
              const avail = coach ? availabilityOf(coach) : { complete: false, missing: ["no profile yet"] };
              return (
                <tr key={person.id} data-filter-row data-filter-text={`${person.firstName} ${person.lastName}`}>
                  <td className="py-2 font-medium">
                    <Link href={`/console/coaches/${person.id}`} className="text-slate-800 hover:text-brand-700 hover:underline">
                      {person.firstName} {person.lastName}
                    </Link>
                    {coach?.isProCoach && <span className="ml-2 badge bg-brand-100 text-brand-800">Pro</span>}
                  </td>
                  <td>
                    {!coach ? (
                      <span className="text-xs text-slate-400">no profile</span>
                    ) : (
                      <form method="POST" action="/api/console/coaches" className="flex items-center gap-2">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="togglePublish" />
                        <input type="hidden" name="personId" value={person.id} />
                        <input type="hidden" name="returnTo" value="/console/coaches" />
                        {coach.publishedOnSite ? (
                          <>
                            <span className="badge bg-emerald-100 text-emerald-800">Published</span>
                            <button className="text-xs text-slate-500 hover:text-rose-600 hover:underline">Hide</button>
                          </>
                        ) : (
                          <>
                            <span className="badge bg-slate-100 text-slate-500">Hidden</span>
                            <button className="text-xs font-semibold text-brand-600 hover:text-brand-800 hover:underline">Publish</button>
                          </>
                        )}
                      </form>
                    )}
                  </td>
                  <td className="hidden text-slate-600 lg:table-cell">{coach?.rpoCertLevel ?? "—"}</td>
                  <td className="hidden sm:table-cell">
                    {gate.ok
                      ? <span className="badge bg-emerald-100 text-emerald-800">cleared</span>
                      : <span className="badge bg-amber-100 text-amber-800" title={gate.reasons.join(", ")}>{gate.reasons.length} issue{gate.reasons.length > 1 ? "s" : ""}</span>}
                  </td>
                  <td>
                    {(() => {
                      const acct = accountByPerson.get(person.id);
                      return <LoginStatus lastLoginAt={acct?.lastLoginAt ?? null} active={acct?.active ?? true} hasAccount={!!acct} />;
                    })()}
                  </td>
                  <td>
                    {person.waiverSignedAt ? (
                      <span className="badge bg-emerald-100 text-emerald-800" title={`Signed ${person.waiverSignedAt.toISOString().slice(0, 10)}`}>signed</span>
                    ) : (
                      <form method="POST" action="/api/console/coaches" className="flex items-center gap-2">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="sendWaiver" />
                        <input type="hidden" name="personId" value={person.id} />
                        <input type="hidden" name="returnTo" value="/console/coaches" />
                        <span className="badge bg-amber-100 text-amber-800">not signed</span>
                        <button className="text-xs font-semibold text-brand-600 hover:text-brand-800 hover:underline">Send waiver</button>
                      </form>
                    )}
                  </td>
                  <td>
                    {avail.complete
                      ? <span className="badge bg-emerald-100 text-emerald-800">complete</span>
                      : <span className="badge bg-amber-100 text-amber-800" title={`Missing: ${avail.missing.join(", ")}`}>needs {avail.missing.join(" + ")}</span>}
                  </td>
                  <td className="hidden text-slate-600 md:table-cell">{coach?._count.teams ?? 0}</td>
                  <td className="hidden text-slate-600 lg:table-cell">
                    {coach?._count.recruits ?? 0}
                    <span className="ml-1 text-xs text-slate-400">credit{(coach?._count.recruits ?? 0) === 1 ? "" : "s"}</span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Link href={`/console/coaches/${person.id}`} className="text-xs font-semibold text-brand-600 hover:text-brand-800 hover:underline">Edit</Link>
                    {session && can(session.role, "manageCoaches") && (
                      <>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <ConfirmSubmit
                          action="/api/console/coaches"
                          fields={{ ticket, op: "removeCoach", personId: person.id, returnTo: "/console/coaches" }}
                          confirm={`Remove ${person.firstName} ${person.lastName} as a coach? This unassigns them from all teams and deletes their coach profile. Their login and any player/parent records are kept.`}
                          label="Remove"
                          className="text-xs text-rose-600 hover:underline"
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {coaches.length === 0 && (
              <tr><td colSpan={10} className="py-8 text-center text-slate-400">No coaches yet.</td></tr>
            )}
            <tr data-filter-empty hidden><td colSpan={10} className="py-8 text-center text-slate-400">No coaches match your search.</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-500">
        Additional teams to a coach require a recruitment credit — earned by the
        registrations that came through them (§5).
      </p>
    </div>
  );
}
