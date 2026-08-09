"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { coachAssignmentGate, canPublishTeam } from "@/lib/domain/teams";
import { formatCents } from "@/lib/money";

async function requireManager() {
  const session = await getSession();
  if (!session || !can(session.role, "manageTeams")) {
    throw new Error("Not authorized to manage teams.");
  }
  return session;
}

export async function updateTeam(formData: FormData) {
  const session = await requireManager();
  const teamId = String(formData.get("teamId") ?? "");
  if (!teamId) throw new Error("Missing team.");

  const g = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };

  const coachId = g("coachId");
  // Coach screening hard gate (§5): no assignment without background check + onboarding.
  if (coachId) {
    const coach = await prisma.coach.findUnique({ where: { id: coachId } });
    if (!coach) throw new Error("Coach not found.");
    const gate = coachAssignmentGate(coach);
    if (!gate.ok) {
      throw new Error(`Cannot assign this coach: ${gate.reasons.join(", ")}.`);
    }
  }

  await prisma.team.update({
    where: { id: teamId },
    data: {
      name: g("name") ?? undefined,
      divisionId: g("divisionId"),
      levelBand: g("levelBand"),
      market: g("market"),
      coachId,
      teamContactId: g("teamContactId"),
      facilityId: g("facilityId"),
      dayOfWeek: g("dayOfWeek"),
      startTime: g("startTime"),
      coachPlays: formData.get("coachPlays") === "on",
    },
  });

  await audit({
    actorId: session.userId,
    entityType: "Team",
    entityId: teamId,
    action: "UPDATE",
    summary: "Updated team fields",
  });

  revalidatePath(`/console/teams/${teamId}`);
  revalidatePath("/console/teams");
}

/** Remove a player from a team; their registration re-enters the pool. */
export async function removePlayer(formData: FormData) {
  const session = await requireManager();
  const teamId = String(formData.get("teamId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  if (!teamId || !personId) return;

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("Team not found.");

  await prisma.teamMember.deleteMany({ where: { teamId, personId } });
  // Send their registration back to the pool for this season.
  await prisma.registration.updateMany({
    where: { personId, seasonId: team.seasonId, status: "ASSIGNED" },
    data: { status: "SUBMITTED" },
  });

  await audit({
    actorId: session.userId,
    entityType: "Team",
    entityId: teamId,
    action: "UNASSIGN",
    summary: `Removed player ${personId} back to pool`,
  });

  revalidatePath(`/console/teams/${teamId}`);
  revalidatePath("/console/pools");
}

export async function publishTeam(formData: FormData) {
  const session = await requireManager();
  const teamId = String(formData.get("teamId") ?? "");
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { facility: true },
  });
  if (!team) throw new Error("Team not found.");

  // Publication gate (§4): complete team + executed facility agreement.
  const gate = canPublishTeam(team, team.facility);
  if (!gate.ok) throw new Error(gate.reason ?? "Cannot publish.");

  await prisma.team.update({
    where: { id: teamId },
    data: { published: true, publishedAt: new Date() },
  });
  await audit({ actorId: session.userId, entityType: "Team", entityId: teamId, action: "PUBLISH", summary: "Published to families" });
  revalidatePath(`/console/teams/${teamId}`);
  revalidatePath("/console/teams");
}

/**
 * Request the season fee from every rostered player who doesn't already have one
 * (§8). Payment is requested only AFTER a player is assigned a team — this action
 * lives on the team, so the published sequence is honored. Coaches on their own
 * team and other waived places are skipped.
 */
export async function requestSeasonFees(formData: FormData) {
  const session = await requireManager();
  const teamId = String(formData.get("teamId") ?? "");
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: { include: { person: true } }, season: true },
  });
  if (!team) throw new Error("Team not found.");

  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  const feeCents = rate?.seasonFeeCents ?? 49500;

  let created = 0;
  for (const m of team.members) {
    // Skip coach-players and anyone with a fee-waived registration this season.
    const reg = await prisma.registration.findFirst({
      where: { personId: m.personId, seasonId: team.seasonId },
    });
    if (reg?.feeWaived || m.roleOnTeam === "COACH_PLAYER") continue;

    const existing = await prisma.payment.findFirst({
      where: {
        partyId: m.personId,
        seasonId: team.seasonId,
        category: "PLAYER_FEE",
        status: { in: ["REQUESTED", "PENDING", "PAID"] },
      },
    });
    if (existing) continue;

    await prisma.payment.create({
      data: {
        direction: "IN",
        partyId: m.personId,
        amountCents: feeCents,
        method: "STRIPE",
        status: "REQUESTED",
        category: "PLAYER_FEE",
        seasonId: team.seasonId,
        description: `${team.season?.name ?? "Season"} fee — ${team.name}`,
      },
    });
    created++;

    // Triggered "payment request" message (§13) — player + parents, after assignment.
    await dispatchMessage({
      senderId: session.userId,
      seasonId: team.seasonId,
      audienceType: "SINGLE_PERSON",
      audienceRef: m.personId,
      channels: ["IN_APP", "EMAIL"],
      triggerType: "PAYMENT_REQUEST",
      subject: "Your season fee is ready",
      body: `Your ${formatCents(feeCents)} season fee for ${team.name} is ready to pay in your portal. The fee reserves a place on a team, not a session count.`,
    });
  }

  await audit({
    actorId: session.userId,
    entityType: "Team",
    entityId: teamId,
    action: "REQUEST_PAYMENT",
    summary: `Requested season fee from ${created} player(s)`,
  });

  revalidatePath(`/console/teams/${teamId}`);
  revalidatePath("/console/payments");
}

export async function unpublishTeam(formData: FormData) {
  const session = await requireManager();
  const teamId = String(formData.get("teamId") ?? "");
  await prisma.team.update({ where: { id: teamId }, data: { published: false } });
  await audit({ actorId: session.userId, entityType: "Team", entityId: teamId, action: "UNPUBLISH" });
  revalidatePath(`/console/teams/${teamId}`);
  revalidatePath("/console/teams");
}
