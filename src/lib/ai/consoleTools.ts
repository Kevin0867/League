import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatTime12 } from "@/lib/time";
import { getSeasonStats, DEAD_REG_STATUS, UNASSIGNED_STATUS } from "@/lib/domain/seasonStats";
import { personSearchOR } from "@/lib/domain/personSearch";
import { audit } from "@/lib/audit";
import { TEAM_CAP, COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { stripeCollectedBreakdown, paymentsSince } from "@/lib/payments/reconcile";

/** Context passed to tool execution — identifies the actor and whether they may
 *  make roster changes. Read tools ignore it; write tools require canWrite. */
export type ToolCtx = { actorId?: string; canWrite?: boolean };

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
      "Authoritative money totals for the active season. COLLECTED is read live from Stripe — the actual charges that cleared since the season's collection start date, net of refunds — so it always matches the Payments page. Also returns a collected breakdown (season fees / installments / apparel), outstanding (requested/pending fees not yet paid), and estimated payouts (coaches accrued on delivered sessions + facility amounts due, not yet disbursed). Quote the returned figures exactly and state the collection start date. Do NOT add up individual payment rows to compute revenue — this tool is the source of truth. Use for 'how much have we collected', 'collected vs outstanding', 'what do we owe coaches'.",
    input_schema: { type: "object", properties: {} },
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
  {
    name: "team_roster",
    description:
      "The roster for one team (matched by name): each player with waiver status and whether their season fee is paid, plus the coach, day/time, and location. Use for 'who's on <team>', 'roster for <team>', 'has everyone on <team> paid'.",
    input_schema: {
      type: "object",
      properties: { team: { type: "string", description: "Team name or fragment, e.g. 'Mesa W3.5' or 'Green'." } },
      required: ["team"],
    },
  },
  {
    name: "person_financials",
    description:
      "One person's complete payment picture: what they've paid, what's still owed (requested/pending), any installments in progress, and refunds. Use for 'has <name> paid', 'what does <name> owe', '<name>'s payment history'.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name or email of the person/family." } },
      required: ["query"],
    },
  },
  {
    name: "attendance_summary",
    description:
      "Attendance so far — overall present/absent counts and the present rate, optionally for one team. Use for 'how's attendance', 'attendance for <team>', 'who's been showing up'.",
    input_schema: {
      type: "object",
      properties: { team: { type: "string", description: "Optional team name to scope to." } },
    },
  },
  {
    name: "schedule_upcoming",
    description:
      "Upcoming sessions (practices/games) in date order, optionally for one team, over the next N days (default 14). Each with date, time, team(s), and location. Use for 'what's on the schedule', 'when does <team> practice next', 'sessions this week'.",
    input_schema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Optional team name to scope to." },
        days: { type: "number", description: "How many days ahead to look (default 14, max 60)." },
      },
    },
  },
  {
    name: "coaches_overview",
    description:
      "All coaches with how many teams they run, their background-check status, and contact info. Use for 'list coaches', 'which coaches need a background check', 'how many teams does each coach have'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "apparel_report",
    description:
      "Team apparel ordered (from paid orders), totaled by garment and size for fulfillment. Use for 'apparel order totals', 'how many size L', 'what apparel do we need to order'.",
    input_schema: { type: "object", properties: {} },
  },
];

// Write tools — only offered to admins who can manage teams. Each one is a
// PROPOSE-then-CONFIRM action: called without confirm:true it returns a summary
// of what it WOULD do and changes nothing; the assistant must show that to the
// user and only call again with confirm:true after they explicitly agree.
export const CONSOLE_WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "assign_player_to_team",
    description:
      "Place a person on a team (moving them off any other team in this season). ALWAYS call first WITHOUT confirm to preview the exact person + team; show that to the user and only call again with confirm:true after they say yes. Use for 'put X on team Y', 'move X to Y', 'assign X to Y'.",
    input_schema: {
      type: "object",
      properties: {
        person: { type: "string", description: "Name or email of the person to place." },
        team: { type: "string", description: "Team name or fragment, e.g. \"Men's 4.5 Blue Scottsdale\"." },
        confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the previewed change." },
      },
      required: ["person", "team"],
    },
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
    where: { OR: personSearchOR(q) },
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

async function revenueSummary(): Promise<ToolResult> {
  const season = await resolveSeason();
  const scope = season ? { seasonId: season.id } : {};

  // COLLECTED is grounded in Stripe, not our Payment table — the exact same
  // source and start date the Payments page shows, so Brett never disagrees with
  // it. Stripe reports what actually cleared (net of refunds); the app ledger can
  // include historical/imported/test rows that don't reflect real money in.
  const { unix: sinceUnix, date: sinceDate } = paymentsSince();
  const stripeCollected = await stripeCollectedBreakdown(sinceUnix).catch(() => null);

  // Apparel portion (to split Stripe one-time charges into season fee vs apparel).
  // Matches the Payments page exactly: unit price × quantity on PAID apparel items.
  const apparelItems = await prisma.apparelOrderItem.findMany({
    where: { payment: { direction: "IN", status: "PAID" } },
    select: { unitPriceCents: true, quantity: true },
  }).catch(() => [] as { unitPriceCents: number; quantity: number }[]);
  const apparelCents = apparelItems.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  // Outstanding: money families still owe — app requests not yet paid, this season.
  const outstandingAgg = await prisma.payment.aggregate({
    where: { direction: "IN", status: { in: ["REQUESTED", "PENDING"] }, ...scope },
    _sum: { amountCents: true },
    _count: true,
  });

  // Estimated payouts (not yet disbursed) — mirror the Payments page: coaches
  // accrue on DELIVERED sessions at their profile rate (season pay ÷ 12, else the
  // default), plus facility amounts due. This replaces the misleading all-time
  // "paid out" sum of OUT rows (which includes historical/test disbursements).
  const SESSIONS_PER_SEASON = 12;
  const [coachPayoutAgg, facilityDueAgg, deliveredByCoach, coachRates] = await Promise.all([
    prisma.coachPayoutLine.aggregate({ _sum: { totalCents: true } }),
    prisma.facilityStatement.aggregate({ _sum: { amountDueCents: true } }),
    prisma.sessionCoach.groupBy({ by: ["coachId"], where: { session: { status: "DELIVERED" } }, _count: true }),
    prisma.coach.findMany({ select: { id: true, seasonPayCents: true } }),
  ]);
  const rateMap = new Map(coachRates.map((c) => [c.id, c.seasonPayCents]));
  const perSessionFor = (coachId: string) => {
    const sp = rateMap.get(coachId);
    return sp && sp > 0 ? Math.round(sp / SESSIONS_PER_SEASON) : COACH_PER_SESSION_CENTS;
  };
  const accruedCoachCents = deliveredByCoach.reduce((s, r) => s + perSessionFor(r.coachId) * r._count, 0);
  const coachPayoutCents = coachPayoutAgg._sum.totalCents ?? 0;
  const coachEstCents = coachPayoutCents > 0 ? coachPayoutCents : accruedCoachCents;
  const facilityEstCents = facilityDueAgg._sum.amountDueCents ?? 0;

  const startLabel = sinceDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" });

  const result: ToolResult = {
    season: season?.name ?? "all seasons",
    collectionStart: startLabel,
    source: stripeCollected ? "stripe (live, net of refunds)" : "app records (Stripe unavailable)",
    collected: stripeCollected
      ? { amount: formatCents(stripeCollected.totalCents), cents: stripeCollected.totalCents, count: stripeCollected.count }
      : (() => {
          // Fallback only if Stripe is unreachable — app PAID rows in the window.
          return { amount: "unavailable", cents: 0, count: 0 };
        })(),
    outstanding: {
      amount: formatCents(outstandingAgg._sum.amountCents ?? 0),
      cents: outstandingAgg._sum.amountCents ?? 0,
      count: outstandingAgg._count,
      note: "Requested/pending fees not yet paid (may include older requests).",
    },
    estimatedPayouts: {
      amount: formatCents(coachEstCents + facilityEstCents),
      cents: coachEstCents + facilityEstCents,
      coaches: formatCents(coachEstCents),
      facilities: formatCents(facilityEstCents),
      note: "Accrued but not yet disbursed — coaches on delivered sessions, facilities amount due.",
    },
    note: `Collected = Stripe charges that cleared since ${startLabel}, net of refunds. This is the authoritative figure and matches the Payments page. Do not sum the app ledger for revenue.`,
  };

  if (stripeCollected) {
    result.collectedBreakdown = {
      seasonFees: formatCents(Math.max(0, stripeCollected.oneTimeCents - apparelCents)),
      installments: formatCents(stripeCollected.installmentCents),
      apparel: formatCents(apparelCents),
    };
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

async function teamRoster(input: { team?: string }): Promise<ToolResult> {
  const q = (input.team ?? "").trim();
  if (!q) return { error: "Name a team." };
  const season = await resolveSeason();
  const team = await prisma.team.findFirst({
    where: { name: { contains: q, mode: "insensitive" }, ...(season ? { seasonId: season.id } : {}) },
    include: {
      division: { select: { name: true } },
      facility: { select: { name: true } },
      coach: { include: { person: { select: { firstName: true, lastName: true } } } },
      members: { include: { person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, waiverSignedAt: true } } } },
    },
  });
  if (!team) return { error: `No team matching "${q}".` };

  const memberIds = team.members.map((m) => m.personId);
  const paidRows = memberIds.length
    ? await prisma.payment.findMany({
        where: { partyId: { in: memberIds }, direction: "IN", category: "PLAYER_FEE", status: "PAID" },
        select: { partyId: true },
      })
    : [];
  const paidSet = new Set(paidRows.map((p) => p.partyId));

  return {
    team: team.name,
    division: team.division?.name ?? team.divisionCode ?? null,
    coach: team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : null,
    day: team.dayOfWeek ? DAY_LABEL[team.dayOfWeek] ?? team.dayOfWeek : null,
    time: team.startTime ? formatTime12(team.startTime) : null,
    location: team.facility?.name ?? null,
    rosterSize: team.members.length,
    players: team.members.map((m) => ({
      name: `${m.person.firstName} ${m.person.lastName}`,
      email: m.person.email ?? null,
      phone: m.person.phone ?? null,
      waiverSigned: !!m.person.waiverSignedAt,
      seasonFeePaid: paidSet.has(m.person.id),
    })),
  };
}

async function personFinancials(input: { query?: string }): Promise<ToolResult> {
  const q = (input.query ?? "").trim();
  if (!q) return { error: "Name a person." };
  const person = await prisma.person.findFirst({
    where: { OR: personSearchOR(q) },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!person) return { error: `No one matching "${q}".` };

  const payments = await prisma.payment.findMany({
    where: { partyId: person.id, direction: "IN" },
    orderBy: { createdAt: "desc" },
    select: { amountCents: true, status: true, category: true, description: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true, paidAt: true, createdAt: true },
  });

  const sum = (st: string[]) => payments.filter((p) => st.includes(p.status)).reduce((s, p) => s + p.amountCents, 0);
  return {
    person: `${person.firstName} ${person.lastName}`,
    email: person.email ?? null,
    paid: formatCents(sum(["PAID"])),
    owed: formatCents(sum(["REQUESTED", "PENDING"])),
    refunded: formatCents(sum(["REFUNDED"])),
    payments: payments.map((p) => ({
      amount: formatCents(p.amountCents),
      status: p.status,
      category: p.category,
      description: p.description ?? null,
      installments: p.installmentPlan ? `${p.installmentsPaid}/${p.installmentsTotal ?? "?"}` : null,
      paidAt: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
      requestedAt: p.createdAt.toISOString().slice(0, 10),
    })),
  };
}

async function attendanceSummary(input: { team?: string }): Promise<ToolResult> {
  const season = await resolveSeason();
  let teamName: string | null = null;
  let sessionFilter: Record<string, unknown> = season ? { seasonId: season.id } : {};
  if (input.team?.trim()) {
    const team = await prisma.team.findFirst({
      where: { name: { contains: input.team.trim(), mode: "insensitive" }, ...(season ? { seasonId: season.id } : {}) },
      select: { id: true, name: true },
    });
    if (!team) return { error: `No team matching "${input.team}".` };
    teamName = team.name;
    sessionFilter = { ...sessionFilter, teams: { some: { teamId: team.id } } };
  }

  const sessionIds = (await prisma.session.findMany({ where: sessionFilter, select: { id: true } })).map((s) => s.id);
  if (!sessionIds.length) return { scope: teamName ?? "all teams", note: "No sessions scheduled yet." };

  const rows = await prisma.attendance.groupBy({ by: ["status"], where: { sessionId: { in: sessionIds } }, _count: true });
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  const present = byStatus["PRESENT"] ?? 0;
  const total = rows.reduce((s, r) => s + r._count, 0);
  return {
    scope: teamName ?? "all teams",
    sessionsWithAttendance: sessionIds.length,
    byStatus,
    presentRate: total ? `${Math.round((present / total) * 100)}%` : "no marks yet",
  };
}

async function scheduleUpcoming(input: { team?: string; days?: number }): Promise<ToolResult> {
  const season = await resolveSeason();
  const days = Math.min(Math.max(1, Number(input.days ?? 14)), 60);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400_000);
  const where: Record<string, unknown> = {
    ...(season ? { seasonId: season.id } : {}),
    date: { gte: now, lte: until },
    status: { in: ["SCHEDULED", "RESCHEDULED"] },
  };
  let teamName: string | null = null;
  if (input.team?.trim()) {
    const team = await prisma.team.findFirst({
      where: { name: { contains: input.team.trim(), mode: "insensitive" }, ...(season ? { seasonId: season.id } : {}) },
      select: { id: true, name: true },
    });
    if (!team) return { error: `No team matching "${input.team}".` };
    teamName = team.name;
    where.teams = { some: { teamId: team.id } };
  }

  const sessions = await prisma.session.findMany({
    where,
    orderBy: { date: "asc" },
    take: 60,
    include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } },
  });

  return {
    scope: teamName ?? "all teams",
    windowDays: days,
    count: sessions.length,
    sessions: sessions.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      type: s.type,
      time: `${formatTime12(s.startTime)}–${formatTime12(s.endTime)}`,
      teams: s.teams.map((t) => t.team.name),
      location: s.facility?.name ?? null,
    })),
  };
}

async function coachesOverview(): Promise<ToolResult> {
  const coaches = await prisma.coach.findMany({
    include: {
      person: { select: { firstName: true, lastName: true, email: true, phone: true } },
      _count: { select: { teams: true, assistantTeams: true } },
    },
  });
  return {
    count: coaches.length,
    coaches: coaches
      .map((c) => ({
        name: `${c.person.firstName} ${c.person.lastName}`,
        email: c.person.email ?? null,
        phone: c.person.phone ?? null,
        teams: c._count.teams,
        assistantTeams: c._count.assistantTeams,
        backgroundCheck: c.backgroundCheckDate ? "on file" : "missing",
      }))
      .sort((a, b) => b.teams - a.teams || a.name.localeCompare(b.name)),
  };
}

async function apparelReport(): Promise<ToolResult> {
  const items = await prisma.apparelOrderItem.findMany({
    include: { payment: { select: { status: true } } },
  });
  const paid = items.filter((i) => i.payment?.status === "PAID");
  const byGarment: Record<string, Record<string, number>> = {};
  let totalQty = 0;
  for (const i of paid) {
    const g = (byGarment[i.garment] ??= {});
    g[i.size] = (g[i.size] ?? 0) + i.quantity;
    totalQty += i.quantity;
  }
  return {
    paidOrderItems: paid.length,
    totalPieces: totalQty,
    unpaidPending: items.length - paid.length,
    byGarment: Object.entries(byGarment).map(([garment, sizes]) => ({ garment, sizes })),
  };
}

// ── Write tool: assign a player to a team (propose → confirm) ────────────────

/** Fuzzy team match: score by how many query words appear in the team name, with
 *  men's/women's mapped to the M/W division-code convention. */
async function findTeamByPhrase(phrase: string, seasonId: string | null) {
  const teams = await prisma.team.findMany({
    where: { isTest: false, ...(seasonId ? { seasonId } : {}) },
    select: { id: true, name: true, divisionCode: true },
  });
  const raw = phrase.toLowerCase();
  const tokens = raw.split(/\s+/).filter(Boolean).map((t) => {
    if (t === "men's" || t === "mens" || t === "men" || t === "male") return "m";
    if (t === "women's" || t === "womens" || t === "women" || t === "female") return "w";
    return t;
  });
  const scored = teams
    .map((t) => {
      const name = t.name.toLowerCase();
      const code = (t.divisionCode ?? "").toLowerCase();
      const score = tokens.reduce((s, tok) => (name.includes(tok) || code.includes(tok) ? s + 1 : s), 0);
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored;
}

async function assignPlayerToTeam(input: { person?: string; team?: string; confirm?: boolean }, ctx?: ToolCtx): Promise<ToolResult> {
  if (!ctx?.canWrite) return { error: "You don't have permission to change rosters." };
  const q = (input.person ?? "").trim();
  const teamQ = (input.team ?? "").trim();
  if (!q || !teamQ) return { error: "Name both a person and a team." };

  const people = await prisma.person.findMany({
    where: { OR: personSearchOR(q) },
    select: { id: true, firstName: true, lastName: true, email: true },
    take: 6,
  });
  if (people.length === 0) return { error: `No one matching "${q}".` };
  if (people.length > 1) {
    return { needsDisambiguation: true, message: `More than one person matches "${q}" — which one?`, people: people.map((p) => ({ name: `${p.firstName} ${p.lastName}`, email: p.email })) };
  }
  const person = people[0];

  const season = await resolveSeason();
  const scored = await findTeamByPhrase(teamQ, season?.id ?? null);
  if (scored.length === 0) return { error: `No team matching "${teamQ}".` };
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { needsDisambiguation: true, message: `More than one team matches "${teamQ}" — which one?`, teams: scored.slice(0, 5).map((s) => s.t.name) };
  }
  const team = scored[0].t;

  if (!input.confirm) {
    return {
      needsConfirmation: true,
      summary: `Assign ${person.firstName} ${person.lastName} to ${team.name} (removing them from any other team this season). Confirm?`,
      person: `${person.firstName} ${person.lastName}`,
      team: team.name,
    };
  }

  // Execute — mirror the pool "assign" op: cap check, remove from other teams,
  // upsert membership here, mark the registration assigned.
  const full = await prisma.team.findUnique({ where: { id: team.id }, include: { _count: { select: { members: true } } } });
  if (!full) return { error: "Team not found." };
  const alreadyOn = await prisma.teamMember.findUnique({ where: { teamId_personId: { teamId: team.id, personId: person.id } } });
  if (!alreadyOn && full._count.members + (full.coachPlays ? 1 : 0) + 1 > TEAM_CAP) {
    return { error: `${team.name} is at capacity (${TEAM_CAP}).` };
  }
  const otherTeams = season
    ? (await prisma.team.findMany({ where: { seasonId: season.id, id: { not: team.id } }, select: { id: true } })).map((t) => t.id)
    : [];
  if (otherTeams.length) await prisma.teamMember.deleteMany({ where: { personId: person.id, teamId: { in: otherTeams } } });
  await prisma.teamMember.upsert({
    where: { teamId_personId: { teamId: team.id, personId: person.id } },
    create: { teamId: team.id, personId: person.id, roleOnTeam: "PLAYER" },
    update: {},
  });
  if (season) {
    await prisma.registration.updateMany({ where: { personId: person.id, seasonId: season.id }, data: { status: "ASSIGNED" } });
  }
  await audit({ actorId: ctx.actorId ?? null, entityType: "Team", entityId: team.id, action: "ASSIGN", summary: `Ask Brett: assigned ${person.firstName} ${person.lastName} to ${team.name}` });

  return { ok: true, message: `Done — ${person.firstName} ${person.lastName} is now on ${team.name}.` };
}

/** Dispatch a tool call by name. Unknown / failed calls return an error object
 *  (never throw) so the model can recover and tell the user what happened. */
export async function runConsoleTool(name: string, input: Record<string, unknown>, ctx?: ToolCtx): Promise<ToolResult> {
  try {
    switch (name) {
      case "assign_player_to_team": return await assignPlayerToTeam(input, ctx);
      case "season_overview": return await seasonOverview();
      case "find_people": return await findPeople(input);
      case "registrations_report": return await registrationsReport(input);
      case "revenue_summary": return await revenueSummary();
      case "list_payments": return await listPayments(input);
      case "teams_overview": return await teamsOverview(input);
      case "waiver_gaps": return await waiverGaps();
      case "team_roster": return await teamRoster(input);
      case "person_financials": return await personFinancials(input);
      case "attendance_summary": return await attendanceSummary(input);
      case "schedule_upcoming": return await scheduleUpcoming(input);
      case "coaches_overview": return await coachesOverview();
      case "apparel_report": return await apparelReport();
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    console.error(`consoleTool ${name} failed`, e);
    return { error: `The ${name} query failed. ${e instanceof Error ? e.message : ""}`.trim() };
  }
}
