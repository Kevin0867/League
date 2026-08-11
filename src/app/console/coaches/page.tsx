import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { coachAssignmentGate } from "@/lib/domain/teams";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { StaffForm } from "./StaffForm";
import { TableFilter } from "@/components/TableFilter";

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
};

export default async function CoachesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
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
  const byPerson = new Map<string, { person: { id: string; firstName: string; lastName: string }; coach: CoachRel }>();
  for (const u of coachUsers) if (u.person) byPerson.set(u.person.id, { person: u.person, coach: u.person.coach });
  for (const c of coachProfiles) if (!byPerson.has(c.personId)) byPerson.set(c.personId, { person: c.person, coach: c });
  const coaches = [...byPerson.values()].sort((a, b) =>
    `${a.person.lastName} ${a.person.firstName}`.localeCompare(`${b.person.lastName} ${b.person.firstName}`)
  );

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
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">
          {sp.ok === "profile" ? "Coach profile updated." : "Account created."}
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

      <div className="max-w-md">
        <TableFilter targetId="coaches-table" placeholder="Search coaches by name…" />
      </div>

      <div className="card overflow-x-auto">
        <table id="coaches-table" className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Coach</th>
              <th className="hidden lg:table-cell">Cert</th>
              <th className="hidden sm:table-cell">Screening</th>
              <th>Availability</th>
              <th className="hidden md:table-cell">Teams</th>
              <th className="hidden lg:table-cell">Recruited</th>
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
                  <td className="hidden text-slate-600 lg:table-cell">{coach?.rpoCertLevel ?? "—"}</td>
                  <td className="hidden sm:table-cell">
                    {gate.ok
                      ? <span className="badge bg-emerald-100 text-emerald-800">cleared</span>
                      : <span className="badge bg-amber-100 text-amber-800" title={gate.reasons.join(", ")}>{gate.reasons.length} issue{gate.reasons.length > 1 ? "s" : ""}</span>}
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
                </tr>
              );
            })}
            {coaches.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No coaches yet.</td></tr>
            )}
            <tr data-filter-empty hidden><td colSpan={6} className="py-8 text-center text-slate-400">No coaches match your search.</td></tr>
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
