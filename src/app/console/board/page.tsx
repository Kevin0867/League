import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { AssignmentBoard, type BoardColumn } from "@/components/AssignmentBoard";
import { TEAM_CAP, TEAM_MIN } from "@/lib/enums";

export const dynamic = "force-dynamic";

const UNASSIGNED = ["SUBMITTED", "WAITLISTED"];

function bandOf(d: { minRating: number | null; maxRating: number | null }): string {
  if (d.minRating != null && d.maxRating != null) return `${d.minRating}–${d.maxRating}`;
  if (d.minRating != null) return `${d.minRating}+`;
  return "";
}

type PoolReg = {
  id: string;
  personId: string;
  person: { firstName: string; lastName: string; waiverSignedAt: Date | null; duprRating: number | null };
  division: { name: string } | null;
  locationPrefs: { marketName: string | null; facility: { market: string | null } | null }[];
};

const toCard = (r: {
  id: string;
  personId: string;
  person: { firstName: string; lastName: string; waiverSignedAt: Date | null; duprRating: number | null };
  division: { name: string } | null;
  partnerRequests?: string | null;
}) => ({
  registrationId: r.id,
  personId: r.personId,
  name: `${r.person.firstName} ${r.person.lastName}`,
  waiver: !!r.person.waiverSignedAt,
  rating: r.person.duprRating ?? null,
  divisionName: r.division?.name ?? null,
  comment: r.partnerRequests ?? null,
});

export default async function BoardPage() {
  const ticket = await mintConsoleTicket();
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
    include: { divisions: { orderBy: { name: "asc" } } },
  });

  if (!season) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assignment board" />
        <p className="text-slate-500">No active PURE Academy season.</p>
      </div>
    );
  }

  const [pool, teams] = await Promise.all([
    prisma.registration.findMany({
      where: { seasonId: season.id, status: { in: UNASSIGNED } },
      include: { person: true, division: true, locationPrefs: { orderBy: { rank: "asc" }, include: { facility: true } } },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.team.findMany({
      where: { seasonId: season.id },
      include: { division: true, facility: true, coach: { include: { person: true } }, members: { include: { person: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const memberPersonIds = teams.flatMap((t) => t.members.map((m) => m.personId));
  const memberRegs = memberPersonIds.length
    ? await prisma.registration.findMany({
        where: { seasonId: season.id, personId: { in: memberPersonIds } },
        include: { person: true, division: true },
      })
    : [];
  const regByPerson = new Map(memberRegs.map((r) => [r.personId, r]));

  const divName = new Map(season.divisions.map((d) => [d.id, d.name]));
  const divBand = new Map(season.divisions.map((d) => [d.id, bandOf(d)]));

  // Group unassigned players into pools by division × their top location.
  const topMarket = (r: PoolReg) => r.locationPrefs[0]?.marketName ?? r.locationPrefs[0]?.facility?.market ?? "";
  const poolMap = new Map<string, { divisionId: string | null; market: string; cards: PoolReg[] }>();
  for (const r of pool as PoolReg[]) {
    const market = topMarket(r);
    const divisionId = (r as unknown as { divisionId: string | null }).divisionId ?? null;
    const key = `${divisionId ?? "none"}::${market}`;
    if (!poolMap.has(key)) poolMap.set(key, { divisionId, market, cards: [] });
    poolMap.get(key)!.cards.push(r);
  }

  const poolColumns: BoardColumn[] = [...poolMap.values()]
    .sort((a, b) => (divName.get(a.divisionId ?? "") ?? "~").localeCompare(divName.get(b.divisionId ?? "") ?? "~"))
    .map((p) => ({
      id: `pool:${p.divisionId ?? "none"}::${p.market}`,
      kind: "pool" as const,
      divisionId: p.divisionId,
      market: p.market || null,
      title: p.divisionId ? divName.get(p.divisionId) ?? "Division" : "Unplaced",
      level: p.divisionId ? divBand.get(p.divisionId) ?? "" : "",
      location: p.market || "Any location",
      cap: null,
      cards: p.cards.map(toCard),
    }));

  const teamColumns: BoardColumn[] = teams.map((t) => ({
    id: t.id,
    kind: "team" as const,
    title: t.name,
    level: t.division?.name ?? t.levelBand ?? "",
    location: t.facility?.name ?? t.market ?? "TBD",
    subtitle: t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : undefined,
    cap: TEAM_CAP - (t.coachPlays ? 1 : 0),
    min: TEAM_MIN - (t.coachPlays ? 1 : 0),
    cards: t.members.map((m) => regByPerson.get(m.personId)).filter((r): r is NonNullable<typeof r> => !!r).map(toCard),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assignment board"
        subtitle="Each pool and team is a tile. Drag a player onto a team to assign, onto a pool to unassign, or between pools to change division/location. Click a name to open and edit the full record."
      />
      <AssignmentBoard ticket={ticket} pools={poolColumns} teams={teamColumns} />
    </div>
  );
}
