import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { coachAssignmentGate, canPublishTeam } from "@/lib/domain/teams";
import { formatCents } from "@/lib/money";

// Team mutations as native-form-POST route handlers with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const teamId = String(formData.get("teamId") ?? "");
  const back = (qs: string) =>
    NextResponse.redirect(
      new URL(teamId ? `/console/teams/${teamId}${qs}` : `/console/teams${qs}`, origin),
      303
    );

  // manageTeams (COO/DIRECTOR) — same check requireManager() enforced.
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  const op = String(formData.get("op") ?? "");

  switch (op) {
    case "updateTeam": {
      if (!teamId) return back("?err=team");

      const g = (k: string) => {
        const v = String(formData.get(k) ?? "").trim();
        return v === "" ? null : v;
      };

      const coachId = g("coachId");
      // Coach screening hard gate (§5): no assignment without background check + onboarding.
      if (coachId) {
        const coach = await prisma.coach.findUnique({ where: { id: coachId } });
        if (!coach) return back("?err=coach");
        const gate = coachAssignmentGate(coach);
        if (!gate.ok) return back("?err=coach");
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
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: "UPDATE",
        summary: "Updated team fields",
      });

      return back("?ok=updateTeam");
    }

    case "removePlayer": {
      // Remove a player from a team; their registration re-enters the pool.
      const personId = String(formData.get("personId") ?? "");
      if (!teamId || !personId) return back("?err=player");

      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return back("?err=notfound");

      await prisma.teamMember.deleteMany({ where: { teamId, personId } });
      // Send their registration back to the pool for this season.
      await prisma.registration.updateMany({
        where: { personId, seasonId: team.seasonId, status: "ASSIGNED" },
        data: { status: "SUBMITTED" },
      });

      await audit({
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: "UNASSIGN",
        summary: `Removed player ${personId} back to pool`,
      });

      return back("?ok=removePlayer");
    }

    case "publishTeam": {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { facility: true },
      });
      if (!team) return back("?err=notfound");

      // Publication gate (§4): complete team + executed facility agreement.
      const gate = canPublishTeam(team, team.facility);
      if (!gate.ok) return back("?err=publish");

      await prisma.team.update({
        where: { id: teamId },
        data: { published: true, publishedAt: new Date() },
      });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "PUBLISH", summary: "Published to families" });
      return back("?ok=publishTeam");
    }

    case "requestSeasonFees": {
      // Request the season fee from every rostered player who doesn't already have
      // one (§8). Payment is requested only AFTER a player is assigned a team — this
      // op lives on the team, so the published sequence is honored. Coaches on their
      // own team and other waived places are skipped.
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: { include: { person: true } }, season: true },
      });
      if (!team) return back("?err=notfound");

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
          senderId: actor.userId,
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
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: "REQUEST_PAYMENT",
        summary: `Requested season fee from ${created} player(s)`,
      });

      return back("?ok=requestSeasonFees");
    }

    case "unpublishTeam": {
      await prisma.team.update({ where: { id: teamId }, data: { published: false } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "UNPUBLISH" });
      return back("?ok=unpublishTeam");
    }

    default:
      return back("?err=op");
  }
}
