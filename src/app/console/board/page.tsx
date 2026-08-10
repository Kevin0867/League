import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { AssignmentBoard, type BoardColumn } from "@/components/AssignmentBoard";
import { TEAM_CAP } from "@/lib/enums";

export const dynamic = "force-dynamic";

const UNASSIGNED = ["SUBMITTED", "WAITLISTED"];

type RegLike = {
  id: string;
  personId: string;
  divisionId: string | null;
  person: { firstName: string; lastName: string; waiverSignedAt: Date | null; duprRating: number | null };
  division: { name: string } | null;
};

const toCard = (r: RegLike) => ({
  registrationId: r.id,
  personId: r.personId,
  name: `${r.person.firstName} ${r.person.lastName}`,
  waiver: !!r.person.waiverSignedAt,
  rating: r.person.duprRating ?? null,
  divisionName: r.division?.name ?? null,
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
      include: { person: true, division: true },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.team.findMany({
      where: { seasonId: season.id },
      include: { division: true, coach: { include: { person: true } }, members: { include: { person: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  // Registrations for currently-rostered players, so team cards can be moved.
  const memberPersonIds = teams.flatMap((t) => t.members.map((m) => m.personId));
  const memberRegs = memberPersonIds.length
    ? await prisma.registration.findMany({
        where: { seasonId: season.id, personId: { in: memberPersonIds } },
        include: { person: true, division: true },
      })
    : [];
  const regByPerson = new Map(memberRegs.map((r) => [r.personId, r]));

  const poolByDivision = new Map<string, RegLike[]>();
  for (const r of pool) {
    const key = r.divisionId ?? "none";
    (poolByDivision.get(key) ?? poolByDivision.set(key, []).get(key)!).push(r);
  }
  const teamsByDivision = new Map<string, typeof teams>();
  for (const t of teams) {
    const key = t.divisionId ?? "none";
    (teamsByDivision.get(key) ?? teamsByDivision.set(key, []).get(key)!).push(t);
  }

  const teamColumn = (t: (typeof teams)[number]): BoardColumn => ({
    id: t.id,
    kind: "team",
    title: t.name,
    subtitle: [t.division?.name, t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : null].filter(Boolean).join(" · ") || undefined,
    cap: TEAM_CAP - (t.coachPlays ? 1 : 0),
    cards: t.members.map((m) => regByPerson.get(m.personId)).filter((r): r is NonNullable<typeof r> => !!r).map(toCard),
  });

  // Interleave: each division's pool column, then that division's teams.
  const columns: BoardColumn[] = [];
  for (const d of season.divisions) {
    columns.push({
      id: `pool:${d.id}`,
      kind: "pool",
      divisionId: d.id,
      title: `${d.name} — pool`,
      cap: null,
      cards: (poolByDivision.get(d.id) ?? []).map(toCard),
    });
    for (const t of teamsByDivision.get(d.id) ?? []) columns.push(teamColumn(t));
  }
  // Unplaced pool + any teams with no division.
  columns.push({
    id: "pool:none",
    kind: "pool",
    divisionId: null,
    title: "Unplaced — pool",
    cap: null,
    cards: (poolByDivision.get("none") ?? []).map(toCard),
  });
  for (const t of teamsByDivision.get("none") ?? []) columns.push(teamColumn(t));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assignment board"
        subtitle="Drag players between division pools and teams. Moves save instantly; no placement email is sent until you send it from the player's page. Click a name to open and edit the full record."
      />
      <AssignmentBoard ticket={ticket} columns={columns} />
    </div>
  );
}
