import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { TEAM_CAP } from "@/lib/enums";

// Pool assignment as native-form-POST route handlers with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

/** Triggered "team assignment" message (§13) — player + parents, on assignment. */
async function notifyAssignment(teamId: string, personIds: string[], seasonId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { facility: true, coach: { include: { person: true } } },
  });
  if (!team) return;
  const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
  const where = team.facility?.name ?? "your location";
  const when = team.dayOfWeek ? `${team.dayOfWeek}${team.startTime ? ` at ${team.startTime}` : ""}` : "a day and time to be confirmed";
  const body = `You've been placed on ${team.name}. Coach: ${coachName}. Location: ${where}. Practice: ${when}. Your season fee request will follow.`;
  for (const personId of personIds) {
    await dispatchMessage({
      seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
      channels: ["IN_APP", "EMAIL"], triggerType: "TEAM_ASSIGNMENT",
      subject: `You're on ${team.name}!`, body,
    });
  }
}

function getSelected(formData: FormData): string[] {
  // registration ids selected via checkboxes named "reg"
  return formData.getAll("reg").map(String).filter(Boolean);
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/pools${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  // Both ops preserve the original requireAssigner() gate: manageTeams (COO/DIRECTOR).
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  switch (op) {
    case "assign": {
      const teamId = String(formData.get("teamId") ?? "");
      const regIds = getSelected(formData);
      if (!teamId || regIds.length === 0) return back("?err=select");

      // Effective roster respects coach-plays (§4): the coach fills a slot. Cap 8
      // is a hard stop; assignment never over-caps a team.
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { _count: { select: { members: true } } },
      });
      if (!team) return back("?err=notfound");
      const effective = team._count.members + (team.coachPlays ? 1 : 0) + regIds.length;
      if (effective > TEAM_CAP) return back("?err=cap");

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
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: "ASSIGN",
        summary: `Assigned ${regs.length} player(s): ${regs.map((r) => `${r.person.firstName} ${r.person.lastName}`).join(", ")}`,
      });

      const t = await prisma.team.findUnique({ where: { id: teamId }, select: { seasonId: true } });
      if (t) await notifyAssignment(teamId, regs.map((r) => r.personId), t.seasonId);

      return back("?ok=assign");
    }

    case "create": {
      const regIds = getSelected(formData);
      const divisionId = String(formData.get("divisionId") ?? "") || null;
      const facilityId = String(formData.get("facilityId") ?? "") || null;
      const seasonId = String(formData.get("seasonId") ?? "");
      const name = String(formData.get("name") ?? "").trim();

      if (!seasonId || !name) return back("?err=fields");
      if (regIds.length > TEAM_CAP) return back("?err=cap");

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
        actorId: actor.userId,
        entityType: "Team",
        entityId: team.id,
        action: "CREATE",
        summary: `Formed "${name}" from pool with ${regs.length} player(s)`,
      });

      await notifyAssignment(team.id, regs.map((r) => r.personId), seasonId);

      return back("?ok=create");
    }

    default:
      return back("?err=op");
  }
}
