import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { coachAssignmentGate, canPublishTeam } from "@/lib/domain/teams";
import { paymentRequestEmail } from "@/lib/payments/paymentRequestEmail";
import { accrueFamilySeasonFee } from "@/lib/payments/familyFee";
import { coachTeamConflicts } from "@/lib/domain/coachSchedule";
import { teamAssignmentEmail } from "@/lib/domain/assignmentEmail";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { appUrl } from "@/lib/stripe";
import { formatTime12 } from "@/lib/time";
import { TEAM_COLOR_PALETTE, deriveDivisionCode } from "@/lib/domain/teamName";

/** Colors used by OTHER teams in the same gender+level group (divisionCode) —
 *  the set a new/edited team must avoid, since every team in a division (e.g.
 *  Women's 3.0) needs a distinct color. */
async function divisionColorsUsed(divisionCode: string, excludeTeamId?: string): Promise<string[]> {
  const rows = await prisma.team.findMany({
    where: { divisionCode, ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}) },
    select: { color: true },
  });
  return rows.map((r) => r.color).filter(Boolean) as string[];
}

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
    case "createTeam": {
      const name = String(formData.get("name") ?? "").trim();
      const seasonId = String(formData.get("seasonId") ?? "").trim();
      if (!name || !seasonId) return NextResponse.redirect(new URL("/console/teams?err=fields", origin), 303);
      const divisionId = String(formData.get("divisionId") ?? "").trim() || null;
      const facilityId = String(formData.get("facilityId") ?? "").trim() || null;
      const dayOfWeek = String(formData.get("dayOfWeek") ?? "").trim() || null;
      const startTime = String(formData.get("startTime") ?? "").trim() || null;
      const facility = facilityId ? await prisma.facility.findUnique({ where: { id: facilityId } }) : null;

      // Optional color at create; uniqueness is enforced on edit and via the
      // bulk "Auto-assign colors" action (grouped by gender+level / divisionCode,
      // which a brand-new team doesn't have yet).
      const color = String(formData.get("color") ?? "").trim() || null;

      const team = await prisma.team.create({
        data: {
          name,
          seasonId,
          divisionId,
          facilityId,
          market: facility?.market ?? null,
          dayOfWeek,
          startTime,
          color,
          origin: "PURE_ACADEMY",
          published: false,
        },
      });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: team.id, action: "team.create", summary: `Created team ${name}` });
      return NextResponse.redirect(new URL(`/console/teams/${team.id}?ok=createTeam`, origin), 303);
    }
    case "updateTeam": {
      if (!teamId) return back("?err=team");

      const g = (k: string) => {
        const v = String(formData.get(k) ?? "").trim();
        return v === "" ? null : v;
      };

      const coachId = g("coachId");
      const force = String(formData.get("force") ?? "") === "1";
      // Coach screening hard gate (§5): no assignment without background check.
      if (coachId) {
        const coach = await prisma.coach.findUnique({ where: { id: coachId } });
        if (!coach) return back("?err=coach");
        const gate = coachAssignmentGate(coach);
        if (!gate.ok) return back("?err=coach");
        // Overlap guard against the coach's OTHER teams, using the new day/time.
        if (!force) {
          const clashes = await coachTeamConflicts({ coachId, dayOfWeek: g("dayOfWeek"), startTime: g("startTime"), excludeTeamId: teamId });
          if (clashes.length) return back(`?err=coachclash&team=${encodeURIComponent(clashes[0].teamName)}`);
        }
      }

      // Color must be unique within the team's gender+level group (divisionCode)
      // — no two Women's 3.0 teams share a color.
      const color = g("color");
      if (color) {
        const cur = await prisma.team.findUnique({ where: { id: teamId }, select: { divisionCode: true } });
        if (cur?.divisionCode) {
          const used = await divisionColorsUsed(cur.divisionCode, teamId);
          if (used.some((c) => c.toLowerCase() === color.toLowerCase())) return back("?err=colorclash");
        }
      }

      await prisma.team.update({
        where: { id: teamId },
        data: {
          name: g("name") ?? undefined,
          divisionId: g("divisionId"),
          levelBand: g("levelBand"),
          market: g("market"),
          color,
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

    // Bulk-set practice day / start time / home facility across many teams from
    // one grid on the Team build board — so imported teams can be scheduled
    // without opening each card. Only fields with a value are written; a blank
    // input leaves that team's existing value untouched (clearing is done from
    // the single-team edit). No auto-messaging — this is pure setup.
    case "setSchedule": {
      const ids = String(formData.get("teamIds") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let updated = 0;
      for (const id of ids) {
        const day = String(formData.get(`day_${id}`) ?? "").trim();
        const time = String(formData.get(`time_${id}`) ?? "").trim();
        const facilityId = String(formData.get(`facility_${id}`) ?? "").trim();
        const data: { dayOfWeek?: string; startTime?: string; facilityId?: string } = {};
        if (day) data.dayOfWeek = day;
        if (time) data.startTime = time;
        if (facilityId) data.facilityId = facilityId;
        if (Object.keys(data).length === 0) continue;
        await prisma.team.update({ where: { id }, data });
        updated++;
      }
      await audit({
        actorId: actor.userId,
        entityType: "Team",
        entityId: "bulk",
        action: "UPDATE",
        summary: `Bulk-set day/time/facility for ${updated} team(s)`,
      });
      return back(`?ok=schedule&n=${updated}`);
    }

    // Deterministically give every team a distinct color within its gender+level
    // group (divisionCode): the first team in Women's 3.0 gets Red, the next Blue,
    // and so on down the palette. Fixes duplicate/blank colors across the board in
    // one click. Teams with no gender+level are left untouched.
    case "autoAssignColors": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const teams = await prisma.team.findMany({
        select: { id: true, divisionCode: true, divisionId: true, market: true, name: true, color: true, division: { select: { name: true } } },
        orderBy: [{ market: "asc" }, { name: "asc" }],
      });
      // Group by a CANONICAL gender+level code so a coded team (divisionCode
      // "W3.0") and an uncoded one whose division name derives to the same code
      // ("Women's Elite 3.0") land in one group. Teams with no division at all
      // are skipped (nothing to group them by).
      const groupKey = (t: (typeof teams)[number]) =>
        t.divisionCode ?? deriveDivisionCode(t.division?.name) ?? t.division?.name ?? (t.divisionId ? `id:${t.divisionId}` : null);
      const byCode = new Map<string, typeof teams>();
      for (const t of teams) {
        const k = groupKey(t);
        if (!k) continue;
        if (!byCode.has(k)) byCode.set(k, []);
        byCode.get(k)!.push(t);
      }
      let changed = 0;
      for (const group of byCode.values()) {
        for (let i = 0; i < group.length; i++) {
          const color = TEAM_COLOR_PALETTE[i % TEAM_COLOR_PALETTE.length];
          if (group[i].color === color) continue;
          await prisma.team.update({ where: { id: group[i].id }, data: { color } });
          changed++;
        }
      }
      await audit({ actorId: actor.userId, entityType: "Team", entityId: "bulk", action: "UPDATE", summary: `Auto-assigned distinct colors to ${changed} team(s) by gender+level` });
      return back(`?ok=colors&n=${changed}`);
    }

    // Assign / move / clear a team's coach from the matching board. A partial
    // update (unlike updateTeam, which rewrites every field), honoring the
    // screening gate. Empty coachId clears the assignment.
    case "assignCoach": {
      if (!teamId) return back("?err=team");
      const coachId = String(formData.get("coachId") ?? "").trim() || null;
      const force = String(formData.get("force") ?? "") === "1";
      // Can be driven from Coach matching or a coach's own profile — bounce back
      // to wherever it was invoked.
      const rawReturn = String(formData.get("returnTo") ?? "");
      const dest = rawReturn.startsWith("/console/coaches/") ? rawReturn : "/console/matching";
      const go = (qs: string) => NextResponse.redirect(new URL(`${dest}${qs}`, origin), 303);
      if (coachId) {
        const coach = await prisma.coach.findUnique({ where: { id: coachId } });
        if (!coach) return go("?err=coach");
        const gate = coachAssignmentGate(coach);
        if (!gate.ok) return go("?err=coach");
        // A coach can hold multiple teams at different times/locations, but not
        // with overlapping day/time. Block unless the admin forces it.
        const team = await prisma.team.findUnique({ where: { id: teamId }, select: { dayOfWeek: true, startTime: true } });
        if (!force) {
          const clashes = await coachTeamConflicts({ coachId, dayOfWeek: team?.dayOfWeek, startTime: team?.startTime, excludeTeamId: teamId });
          if (clashes.length) {
            return go(`?err=coachclash&team=${encodeURIComponent(clashes[0].teamName)}`);
          }
        }
      }
      await prisma.team.update({ where: { id: teamId }, data: { coachId } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN_COACH", summary: coachId ? `Assigned coach ${coachId}` : "Cleared coach" });
      return go(`?ok=${coachId ? "assignedCoach" : "clearedCoach"}`);
    }

    // Add an assistant / additional coach to a team (beyond the head coach).
    case "addTeamCoach": {
      if (!teamId) return back("?err=team");
      const coachId = String(formData.get("coachId") ?? "").trim();
      const role = String(formData.get("role") ?? "ASSISTANT").trim() || "ASSISTANT";
      const force = String(formData.get("force") ?? "") === "1";
      if (!coachId) return back("?err=coach");
      const coach = await prisma.coach.findUnique({ where: { id: coachId } });
      if (!coach) return back("?err=coach");
      const gate = coachAssignmentGate(coach);
      if (!gate.ok) return back("?err=coachgate");

      const team = await prisma.team.findUnique({ where: { id: teamId }, select: { coachId: true, dayOfWeek: true, startTime: true } });
      if (team?.coachId === coachId) return back("?err=coachishead");
      if (!force) {
        const clashes = await coachTeamConflicts({ coachId, dayOfWeek: team?.dayOfWeek, startTime: team?.startTime, excludeTeamId: teamId });
        if (clashes.length) return back(`?err=coachclash&team=${encodeURIComponent(clashes[0].teamName)}`);
      }
      await prisma.teamCoach.upsert({
        where: { teamId_coachId: { teamId, coachId } },
        create: { teamId, coachId, role },
        update: { role },
      });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ADD_COACH", summary: `Added ${role.toLowerCase()} coach ${coachId}` });
      return back("?ok=addTeamCoach");
    }

    case "removeTeamCoach": {
      if (!teamId) return back("?err=team");
      const coachId = String(formData.get("coachId") ?? "").trim();
      if (!coachId) return back("?err=coach");
      await prisma.teamCoach.deleteMany({ where: { teamId, coachId } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "REMOVE_COACH", summary: `Removed additional coach ${coachId}` });
      return back("?ok=removeTeamCoach");
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
        include: { facility: true, _count: { select: { members: true } } },
      });
      if (!team) return back("?err=notfound");

      // Publication gate (§4): complete team + roster minimum + executed facility agreement.
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
      const seasonName = team.season?.name ?? "Season";

      // Roll every newly-billed player up to their household invoice, then email
      // each affected paying adult ONCE with the family total (not per player).
      const affected = new Map<string, string>(); // payerId → paymentId (latest)
      for (const m of team.members) {
        // Skip coach-players and anyone with a fee-waived registration this season.
        const reg = await prisma.registration.findFirst({
          where: { personId: m.personId, seasonId: team.seasonId },
        });
        if (reg?.feeWaived || m.roleOnTeam === "COACH_PLAYER") continue;

        const res = await accrueFamilySeasonFee({ playerId: m.personId, seasonId: team.seasonId, feeCents, seasonName });
        if (res) affected.set(res.payerId, res.paymentId);
      }

      for (const [payerId, paymentId] of affected) {
        const [payer, payment] = await Promise.all([
          prisma.person.findUnique({ where: { id: payerId } }),
          prisma.payment.findUnique({ where: { id: paymentId } }),
        ]);
        if (!payer || !payment) continue;
        const email = paymentRequestEmail({
          name: payer.firstName,
          amountCents: payment.amountCents,
          description: payment.description ?? `${seasonName} season fee`,
          paymentId: payment.id,
        });
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: payerId,
          channels: ["IN_APP", "EMAIL"],
          triggerType: "PAYMENT_REQUEST",
          subject: email.subject,
          body: email.text,
          html: email.html,
        });
      }

      await audit({
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: "REQUEST_PAYMENT",
        summary: `Requested season fee for ${affected.size} household(s)`,
      });

      return back("?ok=requestSeasonFees");
    }

    // LAUNCH — deliberate welcome/placement to the whole team. This is the send
    // that used to fire automatically on assignment; it now happens only when an
    // admin chooses to launch, so families hear from us on our schedule, not on
    // every roster move. Coach-players are skipped.
    case "sendTeamWelcome": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { facility: true, coach: { include: { person: true } }, members: { include: { person: true } } },
      });
      if (!team) return back("?err=notfound");
      const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
      const coachContact = [team.coach?.person.email, team.coach?.person.phone].filter(Boolean).join(" · ") || null;
      const practiceWhen = team.dayOfWeek
        ? `${team.dayOfWeek}${team.startTime ? ` at ${formatTime12(team.startTime)}` : ""}`
        : "A day and time to be confirmed";
      let sent = 0;
      for (const m of team.members) {
        if (m.roleOnTeam === "COACH_PLAYER") continue;
        const email = teamAssignmentEmail({
          name: m.person.firstName,
          teamId: team.id,
          teamName: team.name,
          coachName,
          coachContact,
          locationName: team.facility?.name ?? "To be confirmed",
          locationAddress: team.facility?.exactAddress ?? team.facility?.generalArea ?? null,
          practiceWhen,
        });
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: m.personId,
          channels: ["IN_APP", "EMAIL"],
          triggerType: "TEAM_ASSIGNMENT",
          subject: email.subject,
          body: email.text,
          html: email.html,
        });
        sent++;
      }
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "NOTIFY", summary: `Sent welcome/placement to ${sent} member(s)` });
      return back(`?ok=welcome&n=${sent}`);
    }

    // LAUNCH — waiver requests to rostered players who haven't signed. Tokenized
    // no-login links to the same /waiver/sign flow. Already-signed players and
    // coach-players are skipped.
    case "sendTeamWaivers": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: { include: { person: true } } },
      });
      if (!team) return back("?err=notfound");
      let sent = 0;
      for (const m of team.members) {
        if (m.roleOnTeam === "COACH_PLAYER") continue;
        if (m.person.waiverSignedAt) continue;
        const token = await signWaiverToken(m.personId);
        const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
        const email = waiverRequestEmail({ name: m.person.firstName, link, isMinor: m.person.isMinor });
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: m.personId,
          channels: ["IN_APP", "EMAIL"],
          triggerType: "WAIVER_REQUEST",
          subject: email.subject,
          body: email.text,
          html: email.html,
        });
        sent++;
      }
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "WAIVER_REQUESTED", summary: `Sent waiver request to ${sent} team member(s)` });
      return back(`?ok=waivers&n=${sent}`);
    }

    case "unpublishTeam": {
      await prisma.team.update({ where: { id: teamId }, data: { published: false } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "UNPUBLISH" });
      return back("?ok=unpublishTeam");
    }

    // Delete a team: return its players to the pool, drop its fixtures, remove it.
    case "deleteTeam": {
      const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } });
      if (!team) return back("?err=notfound");

      // Send rostered players back to the pool for the season.
      const memberIds = team.members.map((m) => m.personId);
      if (memberIds.length) {
        await prisma.registration.updateMany({
          where: { personId: { in: memberIds }, seasonId: team.seasonId, status: "ASSIGNED" },
          data: { status: "SUBMITTED" },
        });
      }
      await prisma.teamMember.deleteMany({ where: { teamId } });

      // Remove fixtures that reference this team (and their confirmations).
      const fx = await prisma.fixture.findMany({
        where: { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
        select: { id: true },
      });
      const fxIds = fx.map((f) => f.id);
      if (fxIds.length) {
        await prisma.availabilityConfirmation.deleteMany({ where: { fixtureId: { in: fxIds } } });
        await prisma.fixture.deleteMany({ where: { id: { in: fxIds } } });
      }

      await prisma.team.delete({ where: { id: teamId } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "team.delete", summary: `Deleted team ${team.name}` });
      return NextResponse.redirect(new URL("/console/teams?ok=deleteTeam", origin), 303);
    }

    default:
      return back("?err=op");
  }
}
