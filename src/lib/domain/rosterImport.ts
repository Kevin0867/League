import "server-only";
import { prisma } from "../db";
import { ROSTER_TEAMS, type RosterTeam } from "./rosterAssignments";
import { deriveDivisionCode, teamDisplayName, TEAM_COLOR_PALETTE } from "./teamName";

// One-time club team-assignment import (from the Master Roster spreadsheet).
// Pure planning + a guarded commit: matches each roster name+email to an existing
// registration in the active season, creates the 18 teams, and places players on
// them SILENTLY (no assignment emails/texts — a bulk import must not notify 100+
// families). Re-runnable: team lookup and membership upsert are idempotent.

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Derived, display-ready metadata for one roster team. */
export type TeamMeta = {
  teamId: string;
  name: string;
  market: string;
  divisionCode: string | null;
  color: string | null;
  levelBand: string | null;
  category: string;
};

/**
 * Derive division code, market, and a deterministic color for every roster team.
 * A color is only assigned where a market fields 2+ teams in the same division
 * (matching teamName rules) — assigned in palette order by the team's letter.
 */
export function deriveTeamMeta(teams: RosterTeam[] = ROSTER_TEAMS): TeamMeta[] {
  // Group by division+market to decide where colors are needed.
  const groups = new Map<string, RosterTeam[]>();
  for (const t of teams) {
    const code = deriveDivisionCode(`${t.level} ${t.skill}`) ?? "";
    const key = `${code}|${t.market}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  return teams.map((t) => {
    const divisionCode = deriveDivisionCode(`${t.level} ${t.skill}`);
    const key = `${divisionCode ?? ""}|${t.market}`;
    const group = (groups.get(key) ?? []).slice().sort((a, b) => a.letter.localeCompare(b.letter));
    let color: string | null = null;
    if (group.length > 1) {
      const i = group.findIndex((g) => g.teamId === t.teamId);
      color = TEAM_COLOR_PALETTE[i] ?? null;
    }
    const name = teamDisplayName({ club: "PURE", market: t.market, divisionCode, color });
    return {
      teamId: t.teamId,
      name,
      market: t.market,
      divisionCode,
      color,
      levelBand: t.skill || t.level || null,
      category: t.category,
    };
  });
}

export type PlannedMember = {
  name: string;
  email: string;
  personId: string | null;
  registrationId: string | null;
  currentTeamName: string | null; // already on this team elsewhere in the season?
};

export type PlannedTeam = TeamMeta & {
  existingTeamId: string | null;
  divisionId: string | null;
  members: PlannedMember[];
  matched: number;
  unmatched: PlannedMember[];
};

export type RosterPlan = {
  seasonId: string;
  seasonName: string;
  teams: PlannedTeam[];
  totalPlayers: number;
  totalMatched: number;
  totalUnmatched: number;
  unmatchedNames: string[];
};

async function activeSeason() {
  return prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
  });
}

/**
 * Build the full import plan without writing anything: resolve every roster
 * member to a registration in the active season and lay out the teams to create.
 */
export async function planRosterImport(): Promise<RosterPlan | null> {
  const season = await activeSeason();
  if (!season) return null;

  // Index the season's registrations by person name and by email.
  const regs = await prisma.registration.findMany({
    where: { seasonId: season.id },
    include: { person: { select: { id: true, firstName: true, lastName: true, email: true, email2: true, email3: true } } },
  });
  type Reg = (typeof regs)[number];
  const byName = new Map<string, Reg[]>();
  const byEmail = new Map<string, Reg[]>();
  for (const r of regs) {
    const nm = norm(`${r.person.firstName} ${r.person.lastName}`);
    (byName.get(nm) ?? byName.set(nm, []).get(nm)!).push(r);
    for (const e of [r.person.email, r.person.email2, r.person.email3]) {
      if (!e) continue;
      const key = e.toLowerCase().trim();
      (byEmail.get(key) ?? byEmail.set(key, []).get(key)!).push(r);
    }
  }

  // Which team (if any) each person currently sits on, so the preview shows moves.
  const memberships = await prisma.teamMember.findMany({
    where: { team: { seasonId: season.id } },
    include: { team: { select: { name: true } } },
  });
  const currentTeam = new Map(memberships.map((m) => [m.personId, m.team.name]));

  const metas = deriveTeamMeta();
  const teams: PlannedTeam[] = [];
  let totalMatched = 0;
  let totalPlayers = 0;
  const unmatchedNames: string[] = [];

  for (const rt of ROSTER_TEAMS) {
    const meta = metas.find((m) => m.teamId === rt.teamId)!;

    // Existing team by identity parts (idempotent re-run), else by name.
    const existing = await prisma.team.findFirst({
      where: {
        seasonId: season.id,
        club: "PURE",
        market: meta.market,
        divisionCode: meta.divisionCode ?? undefined,
        color: meta.color ?? null,
      },
      select: { id: true },
    });

    // Link a division by category name if one already exists in the season.
    const division = meta.category
      ? await prisma.division.findFirst({ where: { seasonId: season.id, name: { equals: meta.category, mode: "insensitive" } }, select: { id: true } })
      : null;

    const members: PlannedMember[] = [];
    const unmatched: PlannedMember[] = [];
    for (const m of rt.members) {
      totalPlayers++;
      const nm = norm(m.name);
      let reg: Reg | undefined;
      const nameHits = byName.get(nm) ?? [];
      if (nameHits.length === 1) reg = nameHits[0];
      else if (nameHits.length > 1) {
        // Disambiguate same-name people by the roster email.
        reg = nameHits.find((r) => [r.person.email, r.person.email2, r.person.email3].some((e) => (e ?? "").toLowerCase() === m.email)) ?? nameHits[0];
      } else {
        // No name match — accept an email match only when it's unambiguous.
        const emailHits = byEmail.get(m.email) ?? [];
        if (emailHits.length === 1) reg = emailHits[0];
      }
      const planned: PlannedMember = {
        name: m.name,
        email: m.email,
        personId: reg?.person.id ?? null,
        registrationId: reg?.id ?? null,
        currentTeamName: reg ? currentTeam.get(reg.person.id) ?? null : null,
      };
      members.push(planned);
      if (reg) totalMatched++;
      else {
        unmatched.push(planned);
        unmatchedNames.push(m.name);
      }
    }

    teams.push({
      ...meta,
      existingTeamId: existing?.id ?? null,
      divisionId: division?.id ?? null,
      members,
      matched: members.filter((m) => m.personId).length,
      unmatched,
    });
  }

  return {
    seasonId: season.id,
    seasonName: season.name,
    teams,
    totalPlayers,
    totalMatched,
    totalUnmatched: totalPlayers - totalMatched,
    unmatchedNames,
  };
}

export type CommitResult = { teamsCreated: number; teamsReused: number; assigned: number; skipped: number };

/**
 * Execute the plan: create/reuse each team and place every matched player on it.
 * SILENT — never dispatches a notification. Idempotent: teams are matched by
 * identity before creating, memberships are upserted, and each assigned player is
 * removed from any other team in the season (a clean move).
 */
export async function commitRosterImport(): Promise<CommitResult | null> {
  const plan = await planRosterImport();
  if (!plan) return null;

  const seasonTeamIds = (await prisma.team.findMany({ where: { seasonId: plan.seasonId }, select: { id: true } })).map((t) => t.id);
  let teamsCreated = 0;
  let teamsReused = 0;
  let assigned = 0;
  let skipped = 0;

  for (const t of plan.teams) {
    let teamId = t.existingTeamId;
    if (teamId) {
      teamsReused++;
    } else {
      const created = await prisma.team.create({
        data: {
          name: t.name,
          seasonId: plan.seasonId,
          club: "PURE",
          origin: "PURE_ACADEMY",
          market: t.market,
          divisionCode: t.divisionCode,
          color: t.color,
          levelBand: t.levelBand,
          divisionId: t.divisionId,
        },
        select: { id: true },
      });
      teamId = created.id;
      teamsCreated++;
      seasonTeamIds.push(teamId);
    }

    const otherIds = seasonTeamIds.filter((id) => id !== teamId);
    for (const m of t.members) {
      if (!m.personId) { skipped++; continue; }
      // Clean move: drop from any other team in the season, then place here.
      if (otherIds.length) await prisma.teamMember.deleteMany({ where: { personId: m.personId, teamId: { in: otherIds } } });
      await prisma.teamMember.upsert({
        where: { teamId_personId: { teamId, personId: m.personId } },
        create: { teamId, personId: m.personId, roleOnTeam: "PLAYER" },
        update: {},
      });
      await prisma.registration.updateMany({
        where: { personId: m.personId, seasonId: plan.seasonId, status: { not: "ASSIGNED" } },
        data: { status: "ASSIGNED" },
      });
      assigned++;
    }
  }

  return { teamsCreated, teamsReused, assigned, skipped };
}
