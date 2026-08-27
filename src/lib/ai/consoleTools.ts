import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatTime12 } from "@/lib/time";
import { getSeasonStats, DEAD_REG_STATUS, UNASSIGNED_STATUS } from "@/lib/domain/seasonStats";

// ─────────────────────────────────────────────────────────────────────────────
// Read-only tools for "Ask the Console" (the admin assistant).
//
// EVERY tool here is READ-ONLY. They run real Prisma queries and return compact,
// JSON-serializable summaries the model can reason over and quote back. There is
// deliberately NO create/update/delete surface — the assistant can find and
// report, never mutate.
//
// PII discipline: these return only the operational fields an admin already sees
// throughout the console (names, emails, phones, status, money totals). They do
// NOT return the encrypted-at-rest sensitive fields (home address, emergency
// contacts, medical notes / disclosures) — those are never needed to answer an
// operational question and stay out of the model's context entirely.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_LABEL: Record<string, string> = {
  MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun",
};

/** Resilient active-season resolver — mirrors getSeasonStats so every tool agrees. */
async function resolveSeason(): Promise<{ id: string; name: string } | null> {
  const seasons = await prisma.season.findMany({
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
    select: { id: true, name: true, active: true, program: true },
  });
  const s =
    seasons.find((x) => x.active && x.program === "PURE_ACADEMY") ??
    seasons.find((x) => x.program === "PURE_ACADEMY") ??
    seasons.find((x) => x.active) ??
    seasons[0];
  return s ? { id: s.id, name: s.name } : null;
}

// ── Tool schemas (what the model sees) ───────────────────────────────────────

export const CONSOLE_TOOLS: Anthropic.Tool[] = [
  {
    name: "season_overview",
    description:
      "High-level snapshot of the active season: registration counts (live, distinct people, assigned, waitlisted, awaiting placement), team readiness (total, ready, still building, published, without players), divisions, coaches, facilities, sessions, and outstanding waivers. Use this first for any 'how are we doing' / 'where do things stand' question.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_people",
    description:
      "Search registered people by name, email, or phone (partial, case-insensitive). Returns each person's contact info, minor/guardian status, waiver status, their registration status this season, and which team they're on (if any). Use for 'find X', 'is X registered', 'what team is X on', 'does X have a waiver'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, email, or phone fragment to search for." },
        limit: { type: "number", description: "Max results (default 15, max 50)." },
      },
      required: ["query"],
    },
  },
  {
    name: "registrations_report",
    description:
      "Breakdown of this season's registrations by status and by division, plus the awaiting-placement pool (SUBMITTED/WAITLISTED). Optionally filter to one status. Use for 'how many registered', 'who still needs a team', 'registrations by division'.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Optional filter: SUBMITTED, ASSIGNED, WAITLISTED, WITHDRAWN, DUPLICATE, MERGED.",
        },
        list: {
          type: "boolean",
          description: "If true, also return the individual people (capped at 50) matching the filter — otherwise just counts.",
        },
      },
    },
  },
  {
    name: "revenue_summary",
    description:
      "Money totals for the active season: collected (PAID inbound), outstanding (REQUESTED/PENDING inbound), failed, refunded, and paid out (PAID outbound). Optionally broken down by category (PLAYER_FEE, APPAREL, ACP_ENTRY, PRIVATE_LESSON, etc.). Use for 'how much have we collected', 'what's outstanding', 'revenue by category'.",
    input_schema: {
      type: "object",
      properties: {
        byCategory: { type: "boolean", description: "If true, break the inbound totals down by category." },
      },
    },
  },
  {
    name: "list_payments",
    description:
      "List individual payments, most recent first. Filter by direction (IN/OUT), status (PAID, REQUESTED, PENDING, FAILED, REFUNDED), and/or category. Use for 'show recent payments', 'who hasn't paid', 'list failed payments', 'recent refunds'.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", description: "IN (money in) or OUT (payouts). Default IN." },
        status: { type: "string", description: "PAID, REQUESTED, PENDING, FAILED, or REFUNDED." },
        category: { type: "string", description: "e.g. PLAYER_FEE, APPAREL, ACP_ENTRY, PRIVATE_LESSON." },
        limit: { type: "number", description: "Max rows (default 25, max 100)." },
      },
    },
  },
  {
    name: "teams_overview",
    description:
      "List this season's real teams with their launch status (launched / ready to launch / building), division, market, day & time, coach, roster size, and published state. Optionally filter by launch status. Use for 'which teams are launched', 'what still needs to launch', 'team rosters', 'teams without a coach'.",
    input_schema: {
      type: "object",
      properties: {
        launch: {
          type: "string",
          description: "Optional filter: 'launched', 'ready' (complete but not launched), or 'building' (missing required fields).",
        },
      },
    },
  },
  {
    name: "waiver_gaps",
    description:
      "People with a registration but no signed participation waiver — the compliance gap that blocks the first practice. Returns who they are and how to reach them (capped at 50). Use for 'who still needs a waiver', 'waiver compliance'.",
    input_schema: { type: "object", properties: {} },
  },
];

// ── Tool implementations (what actually runs) ────────────────────────────────

type ToolResult = Record<string, unknown>;

async function seasonOverview(): Promise<ToolResult> {
  const stats = await getSeasonStats();
  if (!stats.season) return { error: "No season found." };
  return {
    season: stats.season.name,
    registrations: stats.registrations,
    teams: stats.teams,
    divisions: stats.divisions,
    coaches: stats.coaches,
    facilities: stats.facilities,
    sessions: stats.sessions,
    waiversOutstanding: stats.waiversOutstanding,
  };
}

async function findPeople(input: { query?: string; limit?: number }): Promise<ToolResult> {
  const q = (input.query ?? "").trim();
  if (!q) return { error: "Provide a name, email, or phone to search for." };
  const limit = Math.min(Math.max(1, Number(input.limit ?? 15)), 50);
  const season = await resolveSeason();

  const people = await prisma.person.findMany({
    where: {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: limit,
    include: {
      guardian: { select: { firstName: true, lastName: true } },
      registrations: season
        ? { where: { seasonId: season.id }, select: { status: true, divisionId: true } }
        : { select: { status: true, divisionId: true }, take: 1 },
      teamMemberships: {
        include: { team: { select: { name: true, seasonId: true } } },
      },
    },
  });

  return {
    season: season?.name ?? null,
    count: people.length,
    people: people.map((p) => {
      const reg = p.registrations[0];
      const team = p.teamMemberships.find((m) => !season || m.team.seasonId === season.id)?.team;
      return {
        name: `${p.firstName} ${p.lastName}`,
        email: p.email ?? null,
        phone: p.phone ?? null,
        isMinor: p.isMinor,
        guardian: p.guardian ? `${p.guardian.firstName} ${p.guardian.lastName}` : null,
        waiverSigned: !!p.waiverSignedAt,
        registrationStatus: reg?.status ?? "not registered this season",
        team: team?.name ?? null,
      };
    }),
  };
}

async function registrationsReport(input: { status?: string; list?: boolean }): Promise<ToolResult> {
  const season = await resolveSeason();
  if (!season) return { error: "No season found." };
  const statusFilter = input.status?.toUpperCase().trim();

  const [byStatus, byDivisionRaw, divisions, awaiting] = await Promise.all([
    prisma.registration.groupBy({ by: ["status"], where: { seasonId: season.id }, _count: true }),
    prisma.registration.groupBy({
      by: ["divisionId"],
      where: { seasonId: season.id, status: { notIn: [...DEAD_REG_STATUS] } },
      _count: true,
    }),
    prisma.division.findMany({ where: { seasonId: season.id }, select: { id: true, name: true } }),
    prisma.registration.count({ where: { seasonId: season.id, status: { in: [...UNASSIGNED_STATUS] } } }),
  ]);

  const divName = new Map(divisions.map((d) => [d.id, d.name]));
  const result: ToolResult = {
    season: season.name,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
    byDivision: byDivisionRaw.map((r) => ({
      division: r.divisionId ? divName.get(r.divisionId) ?? "Unknown" : "No division",
      count: r._count,
    })),
    awaitingPlacement: awaiting,
  };

  if (input.list) {
    const rows = await prisma.registration.findMany({
      where: { seasonId: season.id, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { submittedAt: "desc" },
      take: 50,
      include: {
        person: { select: { firstName: true, lastName: true, email: true, phone: true } },
        division: { select: { name: true } },
      },
    });
    result.people = rows.map((r) => ({
      name: `${r.person.firstName} ${r.person.lastName}`,
      email: r.person.email ?? null,
      phone: r.person.phone ?? null,
      status: r.status,
      division: r.division?.name ?? null,
    }));
    result.listedStatus = statusFilter ?? "all";
    result.listCappedAt50 = rows.length === 50;
  }

  return result;
}

async function revenueSummary(input: { byCategory?: boolean }): Promise<ToolResult> {
  const season = await resolveSeason();
  const scope = season ? { seasonId: season.id } : {};

  const bucket = async (direction: "IN" | "OUT", status: string | { in: string[] }) => {
    const agg = await prisma.payment.aggregate({
      where: { direction, status: typeof status === "string" ? status : status, ...scope },
      _sum: { amountCents: true },
      _count: true,
    });
    return { cents: agg._sum.amountCents ?? 0, count: agg._count };
  };

  const [collected, outstanding, failed, refunded, paidOut] = await Promise.all([
    bucket("IN", "PAID"),
    bucket("IN", { in: ["REQUESTED", "PENDING"] }),
    bucket("IN", "FAILED"),
    bucket("IN", "REFUNDED"),
    bucket("OUT", "PAID"),
  ]);

  const fmt = (b: { cents: number; count: number }) => ({
    amount: formatCents(b.cents),
    cents: b.cents,
    count: b.count,
  });

  const result: ToolResult = {
    season: season?.name ?? "all seasons",
    collected: fmt(collected),
    outstanding: fmt(outstanding),
    failed: fmt(failed),
    refunded: fmt(refunded),
    paidOut: fmt(paidOut),
  };

  if (input.byCategory) {
    const rows = await prisma.payment.groupBy({
      by: ["category", "status"],
      where: { direction: "IN", ...scope },
      _sum: { amountCents: true },
    });
    const cats: Record<string, { collected: number; outstanding: number }> = {};
    for (const r of rows) {
      const c = (cats[r.category] ??= { collected: 0, outstanding: 0 });
      const cents = r._sum.amountCents ?? 0;
      if (r.status === "PAID") c.collected += cents;
      else if (r.status === "REQUESTED" || r.status === "PENDING") c.outstanding += cents;
    }
    result.byCategory = Object.entries(cats).map(([category, v]) => ({
      category,
      collected: formatCents(v.collected),
      collectedCents: v.collected,
      outstanding: formatCents(v.outstanding),
      outstandingCents: v.outstanding,
    }));
  }

  return result;
}

async function listPayments(input: {
  direction?: string;
  status?: string;
  category?: string;
  limit?: number;
}): Promise<ToolResult> {
  const season = await resolveSeason();
  const limit = Math.min(Math.max(1, Number(input.limit ?? 25)), 100);
  const direction = input.direction?.toUpperCase() === "OUT" ? "OUT" : "IN";
  const where: Record<string, unknown> = { direction };
  if (season) where.seasonId = season.id;
  if (input.status) where.status = input.status.toUpperCase().trim();
  if (input.category) where.category = input.category.toUpperCase().trim();

  const rows = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { party: { select: { firstName: true, lastName: true, email: true } } },
  });

  return {
    season: season?.name ?? "all seasons",
    filter: { direction, status: input.status ?? "any", category: input.category ?? "any" },
    count: rows.length,
    cappedAtLimit: rows.length === limit,
    payments: rows.map((p) => ({
      who: p.party ? `${p.party.firstName} ${p.party.lastName}` : "—",
      email: p.party?.email ?? null,
      amount: formatCents(p.amountCents),
      status: p.status,
      category: p.category,
      description: p.description ?? null,
      paidAt: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
      createdAt: p.createdAt.toISOString().slice(0, 10),
    })),
  };
}

async function teamsOverview(input: { launch?: string }): Promise<ToolResult> {
  const season = await resolveSeason();
  if (!season) return { error: "No season found." };

  const teams = await prisma.team.findMany({
    where: { seasonId: season.id, isTest: false },
    orderBy: [{ divisionCode: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { members: true } },
      coach: { include: { person: { select: { firstName: true, lastName: true } } } },
      division: { select: { name: true } },
      facility: { select: { name: true } },
    },
  });

  // Launch status: launched (has launchedAt) > ready (published-eligible-ish:
  // has coach, day, time, facility) > building (missing something).
  const describe = (t: (typeof teams)[number]) => {
    if (t.launchedAt) return "launched";
    const complete = !!(t.coachId && t.dayOfWeek && t.startTime && t.facilityId);
    return complete ? "ready" : "building";
  };

  const filter = input.launch?.toLowerCase().trim();
  const rows = teams
    .map((t) => ({ t, launch: describe(t) }))
    .filter((r) => (filter ? r.launch === filter : true));

  return {
    season: season.name,
    total: teams.length,
    counts: {
      launched: teams.filter((t) => describe(t) === "launched").length,
      ready: teams.filter((t) => describe(t) === "ready").length,
      building: teams.filter((t) => describe(t) === "building").length,
    },
    teams: rows.map(({ t, launch }) => ({
      name: t.name,
      division: t.division?.name ?? t.divisionCode ?? null,
      market: t.market ?? null,
      launch,
      published: t.published,
      day: t.dayOfWeek ? DAY_LABEL[t.dayOfWeek] ?? t.dayOfWeek : null,
      time: t.startTime ? formatTime12(t.startTime) : null,
      coach: t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : null,
      facility: t.facility?.name ?? null,
      roster: t._count.members,
    })),
  };
}

async function waiverGaps(): Promise<ToolResult> {
  const people = await prisma.person.findMany({
    where: { waiverSignedAt: null, registrations: { some: {} } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 50,
    select: { firstName: true, lastName: true, email: true, phone: true, isMinor: true },
  });
  const total = await prisma.person.count({
    where: { waiverSignedAt: null, registrations: { some: {} } },
  });
  return {
    totalOutstanding: total,
    listCappedAt50: people.length === 50,
    people: people.map((p) => ({
      name: `${p.firstName} ${p.lastName}`,
      email: p.email ?? null,
      phone: p.phone ?? null,
      isMinor: p.isMinor,
    })),
  };
}

/** Dispatch a tool call by name. Unknown / failed calls return an error object
 *  (never throw) so the model can recover and tell the user what happened. */
export async function runConsoleTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "season_overview": return await seasonOverview();
      case "find_people": return await findPeople(input);
      case "registrations_report": return await registrationsReport(input);
      case "revenue_summary": return await revenueSummary(input);
      case "list_payments": return await listPayments(input);
      case "teams_overview": return await teamsOverview(input);
      case "waiver_gaps": return await waiverGaps();
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    console.error(`consoleTool ${name} failed`, e);
    return { error: `The ${name} query failed. ${e instanceof Error ? e.message : ""}`.trim() };
  }
}
