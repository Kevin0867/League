import { prisma } from "@/lib/db";
import {
  PROGRESS_WEEKS,
  SR_SERVE, SR_RETURN,
  KA_METRIC,
  DEV_CATEGORIES,
  LADDER_COLUMNS,
} from "@/lib/domain/coachingForms";

// Analytics built from the coaching-form data. Per-player numbers come from the
// quantifiable PlayerProgressEntry rows (serve/return %, kitchen arrival %,
// development ratings, ladder record). Team aggregates roll those up. This is
// what powers both the coach analytics dashboard and the player/parent
// progress report — so the two always agree.

export type WeekPoint = { week: number; value: number | null };

export type TrendStat = {
  series: WeekPoint[];
  first: number | null;   // earliest recorded week
  latest: number | null;  // most recent recorded week
  delta: number | null;   // latest − first (improvement)
  best: number | null;    // best week
  avg: number | null;     // mean of recorded weeks
  count: number;          // recorded weeks
};

export type DevRating = { key: string; label: string; value: number | null };

export type LadderStat = {
  wins: number | null; losses: number | null;
  pointsFor: number | null; pointsAgainst: number | null;
  rank: number | null;
  winPct: number | null; diff: number | null;
};

export type PlayerAnalytics = {
  personId: string;
  name: string;
  serve: TrendStat;
  ret: TrendStat;
  kitchen: TrendStat;
  development: { ratings: DevRating[]; avg: number | null; strengths: string[]; focus: string[] };
  ladder: LadderStat | null;
  hasData: boolean;
};

export type TeamAnalytics = {
  players: PlayerAnalytics[];
  team: {
    serveAvg: number | null;
    returnAvg: number | null;
    kitchenAvg: number | null;
    devSkillAvg: { key: string; label: string; value: number | null }[];
    mostImproved: { personId: string; name: string; delta: number } | null;
    homework: { assigned: number; completed: number; rate: number | null } | null;
    playerCount: number;
    withData: number;
  };
};

const round = (n: number, d = 0) => {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function trend(byWeek: Map<number, number | null>): TrendStat {
  const series: WeekPoint[] = [];
  for (let w = 1; w <= PROGRESS_WEEKS; w++) series.push({ week: w, value: byWeek.get(w) ?? null });
  const recorded = series.filter((p) => p.value !== null) as { week: number; value: number }[];
  const first = recorded.length ? recorded[0].value : null;
  const latest = recorded.length ? recorded[recorded.length - 1].value : null;
  const best = recorded.length ? Math.max(...recorded.map((p) => p.value)) : null;
  const avg = recorded.length ? round(mean(recorded.map((p) => p.value))!, 0) : null;
  const delta = first !== null && latest !== null ? round(latest - first, 0) : null;
  return { series, first, latest, delta, best, avg, count: recorded.length };
}

export async function buildTeamAnalytics(
  teamId: string,
  opts?: { personIds?: string[] },
): Promise<TeamAnalytics> {
  const memberWhere = { teamId, roleOnTeam: "PLAYER" as const, ...(opts?.personIds ? { personId: { in: opts.personIds } } : {}) };
  const members = await prisma.teamMember.findMany({
    where: memberWhere,
    include: { person: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { person: { firstName: "asc" } },
  });
  const personIds = members.map((m) => m.personId);
  const entries = personIds.length
    ? await prisma.playerProgressEntry.findMany({ where: { teamId, personId: { in: personIds } } })
    : [];
  const doc = await prisma.coachingFormDoc.findUnique({ where: { teamId_formSlug: { teamId, formSlug: "homework" } } });

  // index: personId -> metric -> week -> value
  const idx = new Map<string, Map<string, Map<number, number | null>>>();
  for (const e of entries) {
    if (!idx.has(e.personId)) idx.set(e.personId, new Map());
    const m = idx.get(e.personId)!;
    if (!m.has(e.metric)) m.set(e.metric, new Map());
    m.get(e.metric)!.set(e.week, e.value ?? null);
  }
  const weekMap = (personId: string, metric: string) => idx.get(personId)?.get(metric) ?? new Map<number, number | null>();
  const snap = (personId: string, metric: string): number | null => idx.get(personId)?.get(metric)?.get(0) ?? null;

  const players: PlayerAnalytics[] = members.map((m) => {
    const serve = trend(weekMap(m.personId, SR_SERVE));
    const ret = trend(weekMap(m.personId, SR_RETURN));
    const kitchen = trend(weekMap(m.personId, KA_METRIC));

    const ratings: DevRating[] = DEV_CATEGORIES.map((c) => ({ key: c.key, label: c.label, value: snap(m.personId, c.key) }));
    const rated = ratings.filter((r) => r.value !== null) as { key: string; label: string; value: number }[];
    const devAvg = rated.length ? round(mean(rated.map((r) => r.value))!, 1) : null;
    const strengths = rated.filter((r) => r.value >= 3).map((r) => r.label);
    const focus = rated.filter((r) => r.value <= 1).map((r) => r.label);

    const lw = snap(m.personId, "LADDER_WINS");
    const ll = snap(m.personId, "LADDER_LOSSES");
    const lpf = snap(m.personId, "LADDER_PF");
    const lpa = snap(m.personId, "LADDER_PA");
    const lrank = snap(m.personId, "LADDER_RANK");
    const hasLadder = LADDER_COLUMNS.some((c) => snap(m.personId, c.key) !== null);
    const games = (lw ?? 0) + (ll ?? 0);
    const ladder: LadderStat | null = hasLadder ? {
      wins: lw, losses: ll, pointsFor: lpf, pointsAgainst: lpa, rank: lrank,
      winPct: games > 0 ? round(((lw ?? 0) / games) * 100, 0) : null,
      diff: lpf !== null && lpa !== null ? round(lpf - lpa, 0) : null,
    } : null;

    const hasData = serve.count > 0 || ret.count > 0 || kitchen.count > 0 || rated.length > 0 || !!ladder;
    return {
      personId: m.personId,
      name: `${m.person.firstName} ${m.person.lastName}`,
      serve, ret, kitchen,
      development: { ratings, avg: devAvg, strengths, focus },
      ladder, hasData,
    };
  });

  // Team aggregates (latest value per player for the trend metrics).
  const latestVals = (pick: (p: PlayerAnalytics) => number | null) =>
    players.map(pick).filter((v): v is number => v !== null);
  const serveAvg = players.length ? (() => { const v = latestVals((p) => p.serve.latest); return v.length ? round(mean(v)!, 0) : null; })() : null;
  const returnAvg = players.length ? (() => { const v = latestVals((p) => p.ret.latest); return v.length ? round(mean(v)!, 0) : null; })() : null;
  const kitchenAvg = players.length ? (() => { const v = latestVals((p) => p.kitchen.latest); return v.length ? round(mean(v)!, 0) : null; })() : null;

  const devSkillAvg = DEV_CATEGORIES.map((c) => {
    const vals = players.map((p) => p.development.ratings.find((r) => r.key === c.key)?.value ?? null).filter((v): v is number => v !== null);
    return { key: c.key, label: c.label, value: vals.length ? round(mean(vals)!, 1) : null };
  });

  let mostImproved: TeamAnalytics["team"]["mostImproved"] = null;
  for (const p of players) {
    const combined = [p.serve.delta, p.ret.delta, p.kitchen.delta].filter((v): v is number => v !== null);
    if (!combined.length) continue;
    const d = round(mean(combined)!, 0);
    if (d > 0 && (!mostImproved || d > mostImproved.delta)) mostImproved = { personId: p.personId, name: p.name, delta: d };
  }

  let homework: TeamAnalytics["team"]["homework"] = null;
  if (doc?.data && typeof doc.data === "object" && "weeks" in doc.data) {
    const weeks = (doc.data as { weeks?: { assignment?: string; completed?: boolean }[] }).weeks ?? [];
    const assigned = weeks.filter((w) => (w.assignment ?? "").trim() !== "").length;
    const completed = weeks.filter((w) => w.completed).length;
    homework = { assigned, completed, rate: assigned > 0 ? round((completed / assigned) * 100, 0) : null };
  }

  return {
    players,
    team: {
      serveAvg, returnAvg, kitchenAvg, devSkillAvg, mostImproved, homework,
      playerCount: players.length,
      withData: players.filter((p) => p.hasData).length,
    },
  };
}
