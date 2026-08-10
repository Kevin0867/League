import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { AssignmentBoard } from "@/components/AssignmentBoard";
import { TEAM_CAP } from "@/lib/enums";

export const dynamic = "force-dynamic";

const UNASSIGNED = ["SUBMITTED", "WAITLISTED"];

export default async function BoardPage() {
  const ticket = await mintConsoleTicket();
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
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
      include: {
        division: true,
        coach: { include: { person: true } },
        members: { include: { person: true, team: false } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Map each team member back to their registration so the board can move them.
  const memberPersonIds = teams.flatMap((t) => t.members.map((m) => m.personId));
  const memberRegs = memberPersonIds.length
    ? await prisma.registration.findMany({
        where: { seasonId: season.id, personId: { in: memberPersonIds } },
        include: { person: true, division: true },
      })
    : [];
  const regByPerson = new Map(memberRegs.map((r) => [r.personId, r]));

  const card = (r: { id: string; personId: string; person: { firstName: string; lastName: string; waiverSignedAt: Date | null; duprRating: number | null }; division: { name: string } | null }) => ({
    registrationId: r.id,
    personId: r.personId,
    name: `${r.person.firstName} ${r.person.lastName}`,
    waiver: !!r.person.waiverSignedAt,
    rating: r.person.duprRating ?? null,
    divisionName: r.division?.name ?? null,
  });

  const columns = [
    {
      id: "pool",
      title: "Unassigned pool",
      cap: null as number | null,
      cards: pool.map(card),
    },
    ...teams.map((t) => ({
      id: t.id,
      title: t.name,
      subtitle: [t.division?.name, t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : null].filter(Boolean).join(" · ") || undefined,
      cap: TEAM_CAP - (t.coachPlays ? 1 : 0),
      cards: t.members
        .map((m) => regByPerson.get(m.personId))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map(card),
    })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assignment board"
        subtitle="Drag players between the pool and teams. Moves save instantly; no placement email is sent until you send it from the player's page."
      />
      <AssignmentBoard ticket={ticket} columns={columns} />
    </div>
  );
}
