import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { coachAssignmentGate, canPublishTeam } from "@/lib/domain/teams";
import { paymentRequestEmail } from "@/lib/payments/paymentRequestEmail";
import { accruePlayerSeasonFee, placementPayLink } from "@/lib/payments/familyFee";
import { coachTeamConflicts } from "@/lib/domain/coachSchedule";
import { isBookable } from "@/lib/domain/facilityWindows";
import { teamAssignmentEmail } from "@/lib/domain/assignmentEmail";
import { teamLaunchEmail } from "@/lib/domain/launchEmail";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { signWaiverToken, placementWaiverLink } from "@/lib/domain/waiverRenewal";
import { appUrl } from "@/lib/stripe";
import { describeTeamPractice } from "@/lib/domain/practiceInfo";
import { TEAM_COLOR_PALETTE, deriveDivisionCode } from "@/lib/domain/teamName";
import { TEAM_CAP, TEAM_MAX } from "@/lib/enums";
import { personEmails } from "@/lib/domain/audience";

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

/** Every email on file for a rostered player's family — the player's own
 *  addresses (email/email2/email3, where a minor's parent email is stored) plus
 *  the guardian record's, deduped. If there's only one address anywhere, it's
 *  used. Empty only when the family has no email at all. */
function familyEmailsOf(m: {
  person: {
    email?: string | null; email2?: string | null; email3?: string | null;
    guardian?: { email?: string | null; email2?: string | null; email3?: string | null } | null;
  };
}): string[] {
  const g = m.person.guardian;
  return [...new Set([...personEmails(m.person), ...(g ? personEmails(g) : [])])];
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
    // Repair: pull PURE Academy teams (and their sessions) that hold a current
    // registrant but sit in a DIFFERENT season row into the one active season —
    // the fix for "teams built in one season, registrations in another", which
    // makes the Teams page and the Move-to-team picker come up empty.
    case "consolidateSeason": {
      const seasons = await prisma.season.findMany({
        orderBy: [{ active: "desc" }, { startDate: "desc" }],
        select: { id: true, active: true, program: true },
      });
      const target =
        seasons.find((s) => s.active && s.program === "PURE_ACADEMY") ??
        seasons.find((s) => s.program === "PURE_ACADEMY") ??
        seasons.find((s) => s.active) ??
        seasons[0];
      if (!target) return NextResponse.redirect(new URL("/console/teams?err=noseason", origin), 303);

      // Only teams that hold a player registered in the target season — surgical,
      // so old/other-season teams and outside-club teams are left alone.
      const strays = await prisma.team.findMany({
        where: {
          seasonId: { not: target.id },
          origin: "PURE_ACADEMY",
          members: { some: { person: { registrations: { some: { seasonId: target.id } } } } },
        },
        select: { id: true },
      });
      const ids = strays.map((t) => t.id);
      if (ids.length) {
        await prisma.team.updateMany({ where: { id: { in: ids } }, data: { seasonId: target.id } });
        // Bring their sessions along so the schedule stays consistent.
        await prisma.session.updateMany({
          where: { seasonId: { not: target.id }, teams: { some: { teamId: { in: ids } } } },
          data: { seasonId: target.id },
        });
      }
      await audit({ actorId: actor.userId, entityType: "Season", entityId: target.id, action: "CONSOLIDATE_SEASON", summary: `Moved ${ids.length} teams into the active season` });
      return NextResponse.redirect(new URL(`/console/teams?ok=consolidated&n=${ids.length}`, origin), 303);
    }
    // Split Women's 2.5 back out of the 2.5–3.0 band it was consolidated into:
    // relabel teams whose players are ALL 2.5 to the Women's 2.5 division, and
    // move 2.5 players off MIXED teams onto their own market 2.5 team. Reversible.
    case "splitWomens25": {
      const seasons = await prisma.season.findMany({ orderBy: [{ active: "desc" }, { startDate: "desc" }], select: { id: true, active: true, program: true } });
      const target = seasons.find((s) => s.active && s.program === "PURE_ACADEMY") ?? seasons.find((s) => s.program === "PURE_ACADEMY") ?? seasons.find((s) => s.active) ?? seasons[0];
      if (!target) return back("?err=noseason");
      const seasonId = target.id;

      // The Women's 2.5 division in this season (it exists — registrations use it);
      // create it if somehow missing so teams have something to link to.
      const divisions = await prisma.division.findMany({ where: { seasonId }, select: { id: true, name: true } });
      let div25 = divisions.find((d) => deriveDivisionCode(d.name) === "W2.5");
      if (!div25) {
        const created = await prisma.division.create({ data: { seasonId, name: "Women's Elite 2.5", divisionType: "DUPR_BAND", minRating: 2.5, maxRating: 2.5 } });
        div25 = { id: created.id, name: created.name };
      }

      // Players registered as Women's 2.5 this season.
      const regs25 = await prisma.registration.findMany({ where: { seasonId, divisionId: div25.id }, select: { personId: true } });
      const is25 = new Set(regs25.map((r) => r.personId));
      if (is25.size === 0) return back("?err=no25");

      const teams = await prisma.team.findMany({
        where: { seasonId, isTest: false, origin: "PURE_ACADEMY" },
        select: { id: true, name: true, market: true, divisionId: true, divisionCode: true, members: { select: { personId: true } } },
      });

      let relabeled = 0, movedPlayers = 0, createdTeams = 0;
      const marketTeams = new Map<string, { id: string; count: number }>();

      const getOrCreate25Team = async (market: string | null): Promise<string> => {
        const key = market ?? "";
        const existing = marketTeams.get(key);
        if (existing && existing.count < TEAM_CAP) { existing.count++; return existing.id; }
        // An existing W2.5 team in this market with room?
        const found = await prisma.team.findFirst({
          where: { seasonId, divisionId: div25!.id, market, isTest: false },
          select: { id: true, _count: { select: { members: true } } },
        });
        if (found && found._count.members < TEAM_CAP) { marketTeams.set(key, { id: found.id, count: found._count.members + 1 }); return found.id; }
        const t = await prisma.team.create({
          data: { name: `PURE ${market ?? "Academy"} W2.5`, seasonId, divisionId: div25!.id, divisionCode: "W2.5", levelBand: "2.5", market, origin: "PURE_ACADEMY", published: false },
        });
        createdTeams++;
        marketTeams.set(key, { id: t.id, count: 1 });
        return t.id;
      };

      for (const t of teams) {
        if (t.divisionId === div25.id || t.divisionCode === "W2.5") continue; // already 2.5
        const members = t.members.map((m) => m.personId);
        const t25 = members.filter((id) => is25.has(id));
        if (t25.length === 0) continue;

        if (t25.length === members.length) {
          // Pure 2.5 team that was mislabeled → relabel it back.
          await prisma.team.update({ where: { id: t.id }, data: { divisionId: div25.id, divisionCode: "W2.5", levelBand: "2.5" } });
          relabeled++;
        } else {
          // Mixed team → move only the 2.5 players onto a market 2.5 team.
          for (const pid of t25) {
            const destId = await getOrCreate25Team(t.market);
            await prisma.teamMember.deleteMany({ where: { personId: pid, team: { seasonId } } });
            await prisma.teamMember.create({ data: { teamId: destId, personId: pid, roleOnTeam: "PLAYER" } });
            movedPlayers++;
          }
        }
      }

      await audit({ actorId: actor.userId, entityType: "Season", entityId: seasonId, action: "SPLIT_W25", summary: `Split Women's 2.5 out — relabeled ${relabeled} teams, moved ${movedPlayers} players into ${createdTeams} new 2.5 teams` });
      return back(`?ok=split25&relabeled=${relabeled}&moved=${movedPlayers}&created=${createdTeams}`);
    }
    case "createTeam": {
      const name = String(formData.get("name") ?? "").trim();
      const seasonId = String(formData.get("seasonId") ?? "").trim();
      if (!name || !seasonId) return NextResponse.redirect(new URL("/console/teams?err=fields", origin), 303);
      // Reject a duplicate name in the same season — one team per name, so the
      // board never shows two identical teams. (Case-insensitive, done in JS so
      // it's DB-portable.)
      const seasonTeamsForName = await prisma.team.findMany({ where: { seasonId }, select: { id: true, name: true } });
      const dup = seasonTeamsForName.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
      if (dup) return NextResponse.redirect(new URL(`/console/teams/${dup.id}?err=dupname`, origin), 303);
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
      // Coach screening is a WARNING, not a hard gate — the admin decides (the
      // dropdown flags "not cleared"); we still guard genuine day/time clashes.
      if (coachId) {
        const coach = await prisma.coach.findUnique({ where: { id: coachId } });
        if (!coach) return back("?err=coach");
        // Overlap guard against the coach's OTHER teams, using the new day/time.
        if (!force) {
          const clashes = await coachTeamConflicts({ coachId, dayOfWeek: g("dayOfWeek"), startTime: g("startTime"), excludeTeamId: teamId });
          if (clashes.length) return back(`?err=coachclash&team=${encodeURIComponent(clashes[0].teamName)}`);
        }
      }

      // Practice day/time must fall within the chosen facility's availability
      // windows, if that facility defines any. A facility with no windows accepts
      // any day/time (backward compatible).
      {
        const facId = g("facilityId");
        const dow = g("dayOfWeek");
        const startT = g("startTime");
        if (facId && dow && startT) {
          const blocks = await prisma.courtBlock.findMany({ where: { facilityId: facId } });
          if (blocks.length && !isBookable(blocks, dow, startT).ok) return back("?err=slot");
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
          gender: (() => { const v = g("gender"); return v && ["MALE", "FEMALE", "COED"].includes(v) ? v : v === null ? null : undefined; })(),
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
      // Availability windows for every facility referenced in this submit, so a
      // team's day/time can be validated against its facility's open slots.
      const facilityIds = [
        ...new Set(ids.map((id) => String(formData.get(`facility_${id}`) ?? "").trim()).filter(Boolean)),
      ];
      const blocks = facilityIds.length
        ? await prisma.courtBlock.findMany({ where: { facilityId: { in: facilityIds } } })
        : [];
      const blocksByFacility = new Map<string, typeof blocks>();
      for (const b of blocks) {
        if (!blocksByFacility.has(b.facilityId)) blocksByFacility.set(b.facilityId, []);
        blocksByFacility.get(b.facilityId)!.push(b);
      }
      let updated = 0;
      let skipped = 0;
      for (const id of ids) {
        const day = String(formData.get(`day_${id}`) ?? "").trim();
        const time = String(formData.get(`time_${id}`) ?? "").trim();
        const facilityId = String(formData.get(`facility_${id}`) ?? "").trim();
        const data: { dayOfWeek?: string; startTime?: string; facilityId?: string } = {};
        if (day) data.dayOfWeek = day;
        if (time) data.startTime = time;
        if (facilityId) data.facilityId = facilityId;
        if (Object.keys(data).length === 0) continue;
        // If a facility has availability windows, the chosen day/time must fall
        // inside one — otherwise skip this row rather than book an unavailable
        // slot. (Facilities with no windows keep free day/time entry.)
        if (facilityId && day && time) {
          const fb = blocksByFacility.get(facilityId);
          if (fb && fb.length && !isBookable(fb, day, time).ok) {
            skipped++;
            continue;
          }
        }
        await prisma.team.update({ where: { id }, data });
        updated++;
      }
      await audit({
        actorId: actor.userId,
        entityType: "Team",
        entityId: "bulk",
        action: "UPDATE",
        summary: `Bulk-set day/time/facility for ${updated} team(s)${skipped ? `, ${skipped} skipped (outside facility hours)` : ""}`,
      });
      return back(`?ok=schedule&n=${updated}${skipped ? `&skipped=${skipped}` : ""}`);
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
      let overrideNote = "";
      if (coachId) {
        const coach = await prisma.coach.findUnique({ where: { id: coachId } });
        if (!coach) return go("?err=coach");
        // Background-check clearance is a WARNING, not a block — the admin decides
        // (the UI shows "(not cleared)" and confirms). We record the override so
        // an uncleared assignment is never silent in the audit log.
        const gate = coachAssignmentGate(coach);
        if (!gate.ok) overrideNote = ` (OVERRIDE — not cleared: ${gate.reasons.join(", ")})`;
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
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN_COACH", summary: (coachId ? `Assigned coach ${coachId}` : "Cleared coach") + overrideNote });
      return go(`?ok=${coachId ? "assignedCoach" : "clearedCoach"}`);
    }

    // Bulk coach assignment from Coach matching — the whole dirty set in one
    // POST, so an admin edits every team's coach dropdown and saves once.
    // Applied sequentially so an intra-batch time clash (two teams, same slot,
    // same coach) is caught by the DB state the previous change just committed.
    case "assignCoachBulk": {
      const go = (qs: string) => NextResponse.redirect(new URL(`/console/matching${qs}`, origin), 303);
      let changes: { teamId: string; coachId: string | null }[] = [];
      try {
        const parsed = JSON.parse(String(formData.get("changes") ?? "[]"));
        if (Array.isArray(parsed)) {
          changes = parsed
            .map((c) => ({ teamId: String(c?.teamId ?? ""), coachId: (String(c?.coachId ?? "").trim() || null) }))
            .filter((c) => c.teamId);
        }
      } catch {
        return go("?err=bulk");
      }
      const force = String(formData.get("force") ?? "") === "1";
      let applied = 0;
      const skipped: string[] = [];
      for (const ch of changes) {
        const team = await prisma.team.findUnique({ where: { id: ch.teamId }, select: { name: true, dayOfWeek: true, startTime: true } });
        if (!team) { skipped.push(ch.teamId); continue; }
        let bulkOverride = "";
        if (ch.coachId) {
          const coach = await prisma.coach.findUnique({ where: { id: ch.coachId } });
          if (!coach) { skipped.push(team.name); continue; }
          // Not-cleared is a warning, not a skip — record the override instead.
          const g = coachAssignmentGate(coach);
          if (!g.ok) bulkOverride = ` (OVERRIDE — not cleared: ${g.reasons.join(", ")})`;
          // A genuine day/time double-booking is still skipped unless forced.
          if (!force) {
            const clashes = await coachTeamConflicts({ coachId: ch.coachId, dayOfWeek: team.dayOfWeek, startTime: team.startTime, excludeTeamId: ch.teamId });
            if (clashes.length) { skipped.push(team.name); continue; }
          }
        }
        await prisma.team.update({ where: { id: ch.teamId }, data: { coachId: ch.coachId } });
        await audit({ actorId: actor.userId, entityType: "Team", entityId: ch.teamId, action: "ASSIGN_COACH", summary: (ch.coachId ? `Assigned coach ${ch.coachId} (bulk)` : "Cleared coach (bulk)") + bulkOverride });
        applied++;
      }
      const qs = new URLSearchParams({ ok: "bulkCoaches", n: String(applied) });
      if (skipped.length) qs.set("skipped", skipped.slice(0, 6).join(", "));
      return go(`?${qs.toString()}`);
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
      // Clearance is a warning, not a block — record an override if not cleared.
      const gate = coachAssignmentGate(coach);
      const addOverride = gate.ok ? "" : ` (OVERRIDE — not cleared: ${gate.reasons.join(", ")})`;

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
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ADD_COACH", summary: `Added ${role.toLowerCase()} coach ${coachId}${addOverride}` });
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

    // Add a registered player onto this team directly from the team page — same
    // side effects as a pool assignment (one team per season, mark assigned),
    // and silent by design (families hear from us at Launch, not on roster moves).
    case "addPlayer": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const personId = String(formData.get("personId") ?? "");
      if (!teamId || !personId) return back("?err=player");

      const team = await prisma.team.findUnique({ where: { id: teamId }, include: { _count: { select: { members: true } } } });
      if (!team) return back("?err=notfound");
      // Admins may add over the target of 8 up to the hard ceiling of 10, so they
      // can add a player and then move another off. Only 11+ is refused.
      const already = await prisma.teamMember.findUnique({ where: { teamId_personId: { teamId, personId } } });
      const effective = team._count.members + (team.coachPlays ? 1 : 0) + (already ? 0 : 1);
      if (effective > TEAM_MAX) return back("?err=cap");
      const overCap = effective > TEAM_CAP;

      // One team per season: pull them off any other team first.
      const otherTeamIds = (
        await prisma.team.findMany({ where: { seasonId: team.seasonId, id: { not: teamId } }, select: { id: true } })
      ).map((t) => t.id);
      if (otherTeamIds.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: otherTeamIds } } });

      await prisma.teamMember.upsert({
        where: { teamId_personId: { teamId, personId } },
        create: { teamId, personId, roleOnTeam: "PLAYER" },
        update: {},
      });
      await prisma.registration.updateMany({ where: { personId, seasonId: team.seasonId }, data: { status: "ASSIGNED" } });

      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "ASSIGN", summary: `Added player ${personId} to roster${overCap ? ` (over target — now ${effective}/${TEAM_CAP})` : ""}` });
      return back(overCap ? "?ok=addPlayerOver" : "?ok=addPlayer");
    }

    case "publishTeam": {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { facility: true, _count: { select: { members: true } } },
      });
      if (!team) return back("?err=notfound");

      // Publication readiness (complete team + executed facility agreement) is a
      // WARNING the admin can override, not a hard block — the UI confirms with
      // the specific reason. We record the override so it's auditable.
      const gate = canPublishTeam(team, team.facility);
      const pubOverride = gate.ok ? "" : ` (OVERRIDE — ${gate.reason ?? "not fully set up"})`;

      await prisma.team.update({
        where: { id: teamId },
        data: { published: true, publishedAt: new Date() },
      });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "PUBLISH", summary: `Published to families${pubOverride}` });
      return back("?ok=publishTeam");
    }

    case "requestSeasonFees": {
      // Request the season fee from every rostered player who doesn't already have
      // one (§8). Payment is requested only AFTER a player is assigned a team — this
      // op lives on the team, so the published sequence is honored. Coaches on their
      // own team and other waived places are skipped.
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: { include: { person: { include: { guardian: true } } } }, season: true },
      });
      if (!team) return back("?err=notfound");

      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const seasonName = team.season?.name ?? "Season";

      // Per-player: bill each player their own season fee, then email that
      // player's paying adult with that player's invoice (a guardian with two
      // players receives two requests, one per child).
      let billed = 0;
      const noContact: string[] = [];
      for (const m of team.members) {
        // Skip coach-players and anyone with a fee-waived registration this season.
        const reg = await prisma.registration.findFirst({
          where: { personId: m.personId, seasonId: team.seasonId },
        });
        if (reg?.feeWaived || m.roleOnTeam === "COACH_PLAYER") continue;

        const res = await accruePlayerSeasonFee({ playerId: m.personId, seasonId: team.seasonId, feeCents, seasonName });
        const [payer, payment] = await Promise.all([
          prisma.person.findUnique({ where: { id: res.payerId } }),
          prisma.payment.findUnique({ where: { id: res.paymentId } }),
        ]);
        if (!payer || !payment) continue;
        const email = paymentRequestEmail({
          name: payer.firstName,
          amountCents: payment.amountCents,
          description: payment.description ?? `${seasonName} season fee — ${m.person.firstName} ${m.person.lastName}`,
          paymentId: payment.id,
        });
        const familyEmails = familyEmailsOf(m);
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: m.personId,
          channels: ["IN_APP", "EMAIL", "SMS"],
          triggerType: "PAYMENT_REQUEST",
          subject: email.subject,
          body: email.text,
          html: email.html,
          smsBody: email.sms,
          toEmails: familyEmails,
        });
        // The fee is still recorded either way, but flag families with no email
        // on file anywhere so the admin can add an address and resend.
        if (familyEmails.length === 0) noContact.push(`${m.person.firstName} ${m.person.lastName}`);
        billed++;
      }

      await audit({
        actorId: actor.userId,
        entityType: "Team",
        entityId: teamId,
        action: "REQUEST_PAYMENT",
        summary: `Requested season fee for ${billed} player(s)${noContact.length ? `; ${noContact.length} had no email` : ""}`,
      });

      { const q = new URLSearchParams({ ok: "requestSeasonFees", n: String(billed) }); if (noContact.length) { q.set("failed", String(noContact.length)); q.set("failedNames", noContact.slice(0, 6).join(", ")); } return back(`?${q.toString()}`); }
    }

    // LAUNCH — deliberate welcome/placement to the whole team. This is the send
    // that used to fire automatically on assignment; it now happens only when an
    // admin chooses to launch, so families hear from us on our schedule, not on
    // every roster move. Coach-players are skipped.
    case "sendTeamWelcome": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { facility: true, coach: { include: { person: true } }, members: { include: { person: { include: { guardian: true } } } } },
      });
      if (!team) return back("?err=notfound");
      const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
      const coachContact = [team.coach?.person.email, team.coach?.person.phone].filter(Boolean).join(" · ") || null;
      const practiceWhen = await describeTeamPractice(team, team.seasonId);
      let sent = 0;
      const noContact: string[] = [];
      for (const m of team.members) {
        if (m.roleOnTeam === "COACH_PLAYER") continue;
        const pay = await placementPayLink(m.personId, team.seasonId);
        const waiver = await placementWaiverLink(m.personId);
        const email = teamAssignmentEmail({
          name: m.person.firstName,
          teamId: team.id,
          teamName: team.name,
          coachName,
          coachContact,
          locationName: team.facility?.name ?? "To be confirmed",
          locationAddress: team.facility?.exactAddress ?? team.facility?.generalArea ?? null,
          practiceWhen,
          payUrl: pay?.payUrl ?? null,
          feeCents: pay?.feeCents ?? null,
          waiverUrl: waiver.waiverUrl,
        });
        const familyEmails = familyEmailsOf(m);
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: m.personId,
          channels: ["IN_APP", "EMAIL", "SMS"],
          triggerType: "TEAM_ASSIGNMENT",
          subject: email.subject,
          body: email.text,
          html: email.html,
          toEmails: familyEmails,
          smsBody: `PURE Academy — welcome to ${team.name}! ${m.person.firstName}'s team info (coach, location & practice day/time) is in your email.`,
        });
        if (familyEmails.length === 0) noContact.push(`${m.person.firstName} ${m.person.lastName}`);
        else sent++;
      }
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "NOTIFY", summary: `Sent welcome/placement to ${sent} member(s)${noContact.length ? `; ${noContact.length} had no email` : ""}` });
      { const q = new URLSearchParams({ ok: "welcome", n: String(sent) }); if (noContact.length) { q.set("failed", String(noContact.length)); q.set("failedNames", noContact.slice(0, 6).join(", ")); } return back(`?${q.toString()}`); }
    }

    // LAUNCH — waiver requests to rostered players who haven't signed. Tokenized
    // no-login links to the same /waiver/sign flow. Already-signed players and
    // coach-players are skipped.
    case "sendTeamWaivers": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: { include: { person: { include: { guardian: true } } } } },
      });
      if (!team) return back("?err=notfound");
      // all=1 re-sends to everyone (a deliberate resend); otherwise only players
      // who haven't signed yet.
      const resendAll = String(formData.get("all") ?? "") === "1";
      let sent = 0;
      const noContact: string[] = [];
      for (const m of team.members) {
        if (m.roleOnTeam === "COACH_PLAYER") continue;
        if (!resendAll && m.person.waiverSignedAt) continue;
        const token = await signWaiverToken(m.personId);
        const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
        const email = waiverRequestEmail({ name: m.person.firstName, link, isMinor: m.person.isMinor });
        const familyEmails = familyEmailsOf(m);
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
          toEmails: familyEmails,
        });
        if (familyEmails.length === 0) noContact.push(`${m.person.firstName} ${m.person.lastName}`);
        else sent++;
      }
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "WAIVER_REQUESTED", summary: `Sent waiver request to ${sent} team member(s)${noContact.length ? `; ${noContact.length} had no email` : ""}` });
      { const q = new URLSearchParams({ ok: "waivers", n: String(sent) }); if (noContact.length) { q.set("failed", String(noContact.length)); q.set("failedNames", noContact.slice(0, 6).join(", ")); } return back(`?${q.toString()}`); }
    }

    // LAUNCH EVERYTHING — one combined email per household: welcome + team
    // details, pick apparel & pay the season fee, and complete the waiver. Sends
    // to the paying guardian once (covering their players on this team). The
    // individual send buttons remain for one-off follow-ups.
    case "launchTeam": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { facility: true, coach: { include: { person: true } }, members: { include: { person: { include: { guardian: true } } } }, season: true },
      });
      if (!team) return back("?err=notfound");

      const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const feeCents = rate?.seasonFeeCents ?? 49500;
      const seasonName = team.season?.name ?? "Season";
      const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
      const coachContact = [team.coach?.person.email, team.coach?.person.phone].filter(Boolean).join(" · ") || null;
      const practiceWhen = await describeTeamPractice(team, team.seasonId);
      const locationName = team.facility?.name ?? "To be confirmed";
      const locationAddress = team.facility?.exactAddress ?? team.facility?.generalArea ?? null;

      // Per-player: each player gets their own combined email + SMS to their
      // paying adult, with that player's own season-fee invoice. A guardian with
      // two players on the team receives two emails, one per child.
      let sent = 0;
      const noContact: string[] = [];
      for (const m of team.members) {
        if (m.roleOnTeam === "COACH_PLAYER") continue;
        const payerId = m.person.guardianId ?? m.personId;
        const reg = await prisma.registration.findFirst({ where: { personId: m.personId, seasonId: team.seasonId } });
        const res = reg?.feeWaived ? null : await accruePlayerSeasonFee({ playerId: m.personId, seasonId: team.seasonId, feeCents, seasonName });
        if (!res) continue; // fee-waived player — use the individual sends
        const payer = await prisma.person.findUnique({ where: { id: payerId } });
        if (!payer) continue;
        // Always include the participation-waiver link so anyone unsigned is caught.
        const waiverUrl = `${appUrl()}/waiver/sign?token=${encodeURIComponent(await signWaiverToken(payerId))}`;
        const payUrl = `${appUrl()}/pay/${res.paymentId}`;
        const email = teamLaunchEmail({
          recipientName: payer.firstName,
          teamName: team.name,
          players: [`${m.person.firstName} ${m.person.lastName}`],
          coachName,
          coachContact,
          locationName,
          locationAddress,
          practiceWhen,
          payUrl,
          feeCents,
          waiverUrl,
        });
        const smsBody = `PURE Academy — welcome to ${team.name}! Practices: ${practiceWhen}. Pick your team apparel & pay the season fee here: ${payUrl} Full team details + your waiver are in your email.`;
        // Deliver to EVERY email on file for the family (player + guardian). If
        // there's only one address anywhere, it's used.
        const familyEmails = familyEmailsOf(m);
        await dispatchMessage({
          senderId: actor.userId,
          seasonId: team.seasonId,
          audienceType: "SINGLE_PERSON",
          audienceRef: m.personId,
          channels: ["IN_APP", "EMAIL", "SMS"],
          triggerType: "TEAM_LAUNCH",
          subject: email.subject,
          body: email.text,
          html: email.html,
          toEmails: familyEmails,
          smsBody,
        });
        // Only a true no-email-on-file family gets flagged (nothing was delivered).
        if (familyEmails.length === 0) noContact.push(`${m.person.firstName} ${m.person.lastName}`);
        else sent++;
      }
      await prisma.team.update({ where: { id: teamId }, data: { launchedAt: new Date() } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "LAUNCH", summary: `Launched team — combined email to ${sent} family/families${noContact.length ? `; ${noContact.length} had no email on file (${noContact.join(", ")})` : ""}` });
      const lq = new URLSearchParams({ ok: "launched", n: String(sent) });
      if (noContact.length) { lq.set("failed", String(noContact.length)); lq.set("failedNames", noContact.slice(0, 6).join(", ")); }
      return back(`?${lq.toString()}`);
    }

    case "unpublishTeam": {
      await prisma.team.update({ where: { id: teamId }, data: { published: false } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "UNPUBLISH" });
      return back("?ok=unpublishTeam");
    }

    // Delete a team: return its players to the pool, drop its fixtures, remove it.
    // Flag a team as non-production (or clear it). Test teams stay out of
    // pickers, counts, and public pages.
    case "toggleTeamTest": {
      const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, isTest: true, name: true } });
      if (!team) return back("?err=notfound");
      await prisma.team.update({ where: { id: teamId }, data: { isTest: !team.isTest } });
      await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "team.toggleTest", summary: `${!team.isTest ? "Flagged" : "Unflagged"} ${team.name} as test` });
      return back("?ok=toggleTeamTest");
    }

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

    // Merge duplicate teams into one: move every other team's players onto the
    // kept team (deduped), then delete the emptied duplicates. Cleans up the
    // duplicate-teams the board showed, in one click, with no player stranded.
    case "mergeTeams": {
      if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
      const keepId = String(formData.get("keepId") ?? "").trim();
      const removeIds = String(formData.get("removeIds") ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean).filter((id) => id && id !== keepId);
      const keep = await prisma.team.findUnique({ where: { id: keepId } });
      if (!keep || removeIds.length === 0) return back("?err=notfound");

      let movedTeams = 0;
      for (const rid of removeIds) {
        const rt = await prisma.team.findUnique({ where: { id: rid }, include: { members: true } });
        if (!rt || rt.seasonId !== keep.seasonId) continue; // only within the same season
        for (const m of rt.members) {
          await prisma.teamMember.upsert({
            where: { teamId_personId: { teamId: keepId, personId: m.personId } },
            create: { teamId: keepId, personId: m.personId, roleOnTeam: m.roleOnTeam ?? "PLAYER" },
            update: {},
          });
        }
        await prisma.teamMember.deleteMany({ where: { teamId: rid } });
        const fx = await prisma.fixture.findMany({ where: { OR: [{ homeTeamId: rid }, { awayTeamId: rid }] }, select: { id: true } });
        const fxIds = fx.map((f) => f.id);
        if (fxIds.length) {
          await prisma.availabilityConfirmation.deleteMany({ where: { fixtureId: { in: fxIds } } });
          await prisma.fixture.deleteMany({ where: { id: { in: fxIds } } });
        }
        await prisma.team.delete({ where: { id: rid } });
        movedTeams++;
      }

      // Every player now on the kept team is ASSIGNED (not stranded in the pool).
      const keepMemberIds = (await prisma.teamMember.findMany({ where: { teamId: keepId }, select: { personId: true } })).map((m) => m.personId);
      if (keepMemberIds.length) {
        await prisma.registration.updateMany({
          where: { personId: { in: keepMemberIds }, seasonId: keep.seasonId, status: { in: ["SUBMITTED", "WAITLISTED"] } },
          data: { status: "ASSIGNED" },
        });
      }

      await audit({ actorId: actor.userId, entityType: "Team", entityId: keepId, action: "team.merge", summary: `Merged ${movedTeams} duplicate(s) into ${keep.name}` });
      return NextResponse.redirect(new URL(`/console/teams?ok=merged&n=${movedTeams}`, origin), 303);
    }

    default:
      return back("?err=op");
  }
}
