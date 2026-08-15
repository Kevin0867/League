import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { teamAssignmentEmail } from "@/lib/domain/assignmentEmail";
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
    include: {
      facility: true,
      coach: { include: { person: true } },
      members: { include: { person: true } },
    },
  });
  if (!team) return;
  const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
  const coachContact =
    [team.coach?.person.email, team.coach?.person.phone].filter(Boolean).join(" · ") || null;
  const locationName = team.facility?.name ?? "To be confirmed";
  // Assigned players may see the exact address (§15); private courts show general area otherwise.
  const locationAddress = team.facility?.exactAddress ?? team.facility?.generalArea ?? null;
  const practiceWhen = team.dayOfWeek
    ? `${team.dayOfWeek}${team.startTime ? ` at ${team.startTime}` : ""}`
    : "A day and time to be confirmed";

  for (const personId of personIds) {
    const person = team.members.find((m) => m.personId === personId)?.person;
    const firstName = person?.firstName ?? "there";
    const email = teamAssignmentEmail({
      name: firstName,
      teamId: team.id,
      teamName: team.name,
      coachName,
      coachContact,
      locationName,
      locationAddress,
      practiceWhen,
    });
    await dispatchMessage({
      seasonId, audienceType: "SINGLE_PERSON", audienceRef: personId,
      channels: ["IN_APP", "EMAIL"], triggerType: "TEAM_ASSIGNMENT",
      subject: email.subject, body: email.text, html: email.html,
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

      // One team per season: the other teams a player must be removed from when
      // placed here, so assigning never leaves them on two rosters.
      const otherTeamIds = (
        await prisma.team.findMany({ where: { seasonId: team.seasonId, id: { not: teamId } }, select: { id: true } })
      ).map((t) => t.id);

      for (const reg of regs) {
        // Assign each person once (§4): remove from other teams, then upsert
        // idempotent membership here and mark assigned.
        if (otherTeamIds.length) await prisma.teamMember.deleteMany({ where: { personId: reg.personId, teamId: { in: otherTeamIds } } });
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

      // Silent by design: pool placement never auto-messages players/parents.
      // Messaging goes out deliberately later from the team Launch flow.
      if (String(formData.get("notify") ?? "") === "1") {
        const t = await prisma.team.findUnique({ where: { id: teamId }, select: { seasonId: true } });
        if (t) await notifyAssignment(teamId, regs.map((r) => r.personId), t.seasonId);
      }

      return back("?ok=assign");
    }

    case "create": {
      const regIds = getSelected(formData);
      const divisionId = String(formData.get("divisionId") ?? "") || null;
      const facilityId = String(formData.get("facilityId") ?? "") || null;
      const seasonId = String(formData.get("seasonId") ?? "");
      const name = String(formData.get("name") ?? "").trim();

      if (!seasonId || !name) return back("?err=fields");

      // Reuse an existing same-name team in this season instead of creating a
      // duplicate — the name encodes division + market + color, so the same name
      // is the same intended team. This makes "Form team" idempotent, so a
      // double-click or re-submit adds to the one team rather than spawning a
      // second board with the same players.
      const seasonTeams = await prisma.team.findMany({
        where: { seasonId },
        select: { id: true, name: true, coachPlays: true, _count: { select: { members: true } } },
      });
      const existing = seasonTeams.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());

      // Cap guard against the target's current roster (0 for a brand-new team).
      const base = existing ? existing._count.members + (existing.coachPlays ? 1 : 0) : 0;
      if (base + regIds.length > TEAM_CAP) return back("?err=cap");

      let teamId: string;
      if (existing) {
        teamId = existing.id;
      } else {
        // Derive market from the facility for the team's six fields.
        const facility = facilityId ? await prisma.facility.findUnique({ where: { id: facilityId } }) : null;
        const created = await prisma.team.create({
          data: { name, seasonId, divisionId, facilityId, market: facility?.market ?? null, origin: "PURE_ACADEMY", published: false },
        });
        teamId = created.id;
      }

      // One team per season: drop each player from any OTHER team first, so a
      // player is never left on two teams (the root of the duplicate rosters).
      const otherTeamIds = seasonTeams.filter((t) => t.id !== teamId).map((t) => t.id);
      const regs = await prisma.registration.findMany({
        where: { id: { in: regIds } },
        include: { person: true },
      });
      for (const reg of regs) {
        if (otherTeamIds.length) await prisma.teamMember.deleteMany({ where: { personId: reg.personId, teamId: { in: otherTeamIds } } });
        await prisma.teamMember.upsert({
          where: { teamId_personId: { teamId, personId: reg.personId } },
          create: { teamId, personId: reg.personId, roleOnTeam: "PLAYER" },
          update: {},
        });
        await prisma.registration.update({ where: { id: reg.id }, data: { status: "ASSIGNED" } });
      }

      await audit({
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: existing ? "ASSIGN" : "CREATE",
        summary: `${existing ? "Added to" : "Formed"} "${name}" — ${regs.length} player(s)`,
      });

      // Silent by design: forming a team from the pool never auto-messages.
      if (String(formData.get("notify") ?? "") === "1")
        await notifyAssignment(teamId, regs.map((r) => r.personId), seasonId);

      return back(existing ? "?ok=assign" : "?ok=create");
    }

    default:
      return back("?err=op");
  }
}
