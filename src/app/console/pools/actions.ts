"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { TEAM_CAP } from "@/lib/enums";

async function requireAssigner() {
  const session = await getSession();
  if (!session || !can(session.role, "manageTeams")) {
    throw new Error("Not authorized to assign players.");
  }
  return session;
}

function getSelected(formData: FormData): string[] {
  // registration ids selected via checkboxes named "reg"
  return formData.getAll("reg").map(String).filter(Boolean);
}

/**
 * Effective roster respects coach-plays (§4): the coach fills a slot. Cap 8 is
 * a hard stop; assignment never over-caps a team.
 */
async function assertCapacity(teamId: string, adding: number) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { _count: { select: { members: true } } },
  });
  if (!team) throw new Error("Team not found.");
  const effective = team._count.members + (team.coachPlays ? 1 : 0) + adding;
  if (effective > TEAM_CAP) {
    throw new Error(
      `Assigning ${adding} would exceed the cap of ${TEAM_CAP} (team would reach ${effective}).`
    );
  }
  return team;
}

/** Assign the selected registrations' players onto an existing team. */
export async function assignToTeam(formData: FormData) {
  const session = await requireAssigner();
  const teamId = String(formData.get("teamId") ?? "");
  const regIds = getSelected(formData);
  if (!teamId || regIds.length === 0) return;

  await assertCapacity(teamId, regIds.length);

  const regs = await prisma.registration.findMany({
    where: { id: { in: regIds } },
    include: { person: true },
  });

  for (const reg of regs) {
    // Assign each person once (§4): idempotent membership, mark assigned.
    await prisma.teamMember.upsert({
      where: { teamId_personId: { teamId, personId: reg.personId } },
      create: { teamId, personId: reg.personId, roleOnTeam: "PLAYER" },
      update: {},
    });
    await prisma.registration.update({
      where: { id: reg.id },
      data: { status: "ASSIGNED" },
    });
  }

  await audit({
    actorId: session.userId,
    entityType: "Team",
    entityId: teamId,
    action: "ASSIGN",
    summary: `Assigned ${regs.length} player(s): ${regs.map((r) => `${r.person.firstName} ${r.person.lastName}`).join(", ")}`,
  });

  revalidatePath("/console/pools");
  revalidatePath("/console/teams");
  revalidatePath(`/console/teams/${teamId}`);
}

/** Create a new team pre-filled from a pool and assign the selected players. */
export async function createTeamFromPool(formData: FormData) {
  const session = await requireAssigner();
  const regIds = getSelected(formData);
  const divisionId = String(formData.get("divisionId") ?? "") || null;
  const facilityId = String(formData.get("facilityId") ?? "") || null;
  const seasonId = String(formData.get("seasonId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!seasonId || !name) throw new Error("Team name and season are required.");
  if (regIds.length > TEAM_CAP) {
    throw new Error(`Cannot assign ${regIds.length} players — cap is ${TEAM_CAP}.`);
  }

  // Derive market from the facility for the team's six fields.
  const facility = facilityId
    ? await prisma.facility.findUnique({ where: { id: facilityId } })
    : null;

  const team = await prisma.team.create({
    data: {
      name,
      seasonId,
      divisionId,
      facilityId,
      market: facility?.market ?? null,
      origin: "PURE_ACADEMY",
      published: false,
    },
  });

  const regs = await prisma.registration.findMany({
    where: { id: { in: regIds } },
    include: { person: true },
  });
  for (const reg of regs) {
    await prisma.teamMember.upsert({
      where: { teamId_personId: { teamId: team.id, personId: reg.personId } },
      create: { teamId: team.id, personId: reg.personId, roleOnTeam: "PLAYER" },
      update: {},
    });
    await prisma.registration.update({ where: { id: reg.id }, data: { status: "ASSIGNED" } });
  }

  await audit({
    actorId: session.userId,
    entityType: "Team",
    entityId: team.id,
    action: "CREATE",
    summary: `Formed "${name}" from pool with ${regs.length} player(s)`,
  });

  revalidatePath("/console/pools");
  revalidatePath("/console/teams");
}
