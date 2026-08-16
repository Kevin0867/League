import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { PoolsSearch } from "@/components/PoolsSearch";
import { buildPools, type PoolRegistration } from "@/lib/domain/pools";
import { TEAM_CAP } from "@/lib/enums";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { UNASSIGNED_STATUS } from "@/lib/domain/seasonStats";
import { RosteringTabs } from "@/components/RosteringTabs";

export const dynamic = "force-dynamic";

// Registrations still in the assignment pool — everything not yet placed. Shared
// with the board and the Registrations "unassigned" filter so all three agree.
const UNASSIGNED = [...UNASSIGNED_STATUS];

const ERRORS: Record<string, string> = {
  auth: "Not authorized to assign players.",
  select: "Select at least one player and a team.",
  cap: `That assignment would exceed the team cap of ${TEAM_CAP}.`,
  fields: "Team name and season are required.",
  notfound: "Team not found.",
  op: "Unknown operation.",
};

const OKS: Record<string, string> = {
  assign: "Players assigned to the team.",
  create: "New team formed from the pool.",
};

export default async function PoolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
  });

  if (!season) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assignment pools" />
        <p className="text-slate-500">No active PURE Academy season.</p>
      </div>
    );
  }

  const [registrations, teams] = await Promise.all([
    prisma.registration.findMany({
      where: { seasonId: season.id, status: { in: UNASSIGNED } },
      include: {
        person: true,
        division: true,
        locationPrefs: { include: { facility: true }, orderBy: { rank: "asc" } },
      },
    }),
    prisma.team.findMany({
      where: { seasonId: season.id },
      include: { _count: { select: { members: true } }, division: true },
    }),
  ]);

  const poolRegs: PoolRegistration[] = registrations.map((r) => ({
    registrationId: r.id,
    personId: r.personId,
    personName: `${r.person.firstName} ${r.person.lastName}`,
    duprRating: r.person.duprRating ?? r.duprRatingAtReg ?? null,
    waiverSigned: !!r.person.waiverSignedAt,
    divisionId: r.divisionId,
    divisionName: r.division?.name ?? null,
    timePref: r.practiceTimePref,
    locationPrefs: r.locationPrefs
      .filter((lp) => lp.facility)
      .map((lp) => ({ facilityId: lp.facilityId!, facilityName: lp.facility!.name, rank: lp.rank })),
  }));

  const pools = buildPools(poolRegs);

  const teamOptions = teams.map((t) => ({
    id: t.id,
    name: t.name,
    divisionId: t.divisionId,
    remaining: Math.max(0, TEAM_CAP - t._count.members - (t.coachPlays ? 1 : 0)),
  }));

  const totalUnassigned = registrations.length;
  const launchable = pools.filter((p) => p.viability === "launchable").length;

  return (
    <div className="space-y-6">
      <RosteringTabs active="pools" />
      {sp.ok && OKS[sp.ok] && (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{OKS[sp.ok]}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{ERRORS[sp.err] ?? "Assignment failed."}</p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Assignment pools"
          subtitle="Every viable division × location × time. Click a player's name to open their record — edit details and assign them to a team or location. Or select players and form/add them to a team. Pools overlap; assigning removes them from the others."
        />
        <div className="flex gap-3 text-sm">
          <Pill label="Unassigned" value={totalUnassigned} />
          <Pill label="Pools" value={pools.length} />
          <Pill label="Launchable" value={launchable} tone="emerald" />
        </div>
      </div>

      {pools.length === 0 ? (
        <div className="card">
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No unassigned registrations. Everyone is placed, or none have registered yet.
          </p>
        </div>
      ) : (
        <PoolsSearch pools={pools} teams={teamOptions} seasonId={season.id} ticket={ticket} />
      )}
    </div>
  );
}

function Pill({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" }) {
  const tones = { slate: "bg-slate-100 text-slate-700", emerald: "bg-emerald-100 text-emerald-800" };
  return (
    <div className={`rounded-lg px-3 py-1.5 ${tones[tone]}`}>
      <span className="font-bold">{value}</span> <span className="text-xs">{label}</span>
    </div>
  );
}
