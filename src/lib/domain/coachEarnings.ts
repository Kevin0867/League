import "server-only";
import { prisma } from "@/lib/db";
import { isSessionComplete, alaCarteEarnedCents } from "@/lib/domain/coachPay";
import { coachSessionPayCents } from "@/lib/domain/finance";
import { COACH_PER_SESSION_CENTS } from "@/lib/enums";
import { leagueChampionshipCoachSessions, teamPracticeCoachSessions } from "@/lib/domain/pnl";

// Per-coach earned-fee breakdown, derived from the same source of truth as the
// payout register: a coach earns on every session they were the PAYABLE coach
// for once its class time has passed (see coachPay.ts). Substitute coverage
// already moves the payable flag to whoever worked the class, so a sub earns the
// session they covered and the regular coach does not — this helper surfaces
// that, naming who a sub covered for.
//
// Pay per session follows the configured rule (coachSessionPayCents): PRIMARY and
// SUBSTITUTE earn the flat per-session rate ($100), an ASSISTANT earns 50%. The
// per-session base is the coach's own rate (season pay ÷ 12) when set, else the
// configured default — the same figure a coach sees on their dashboard.

const SESSIONS_PER_SEASON = 12;

export type EarnedSession = {
  sessionId: string;
  date: Date;
  startTime: string;
  endTime: string;
  teamName: string | null;
  /** PRIMARY | ASSISTANT | SUBSTITUTE | BACKUP */
  role: string;
  /** When this coach was a SUBSTITUTE, the regular coach they covered for. */
  coveringForName: string | null;
  payCents: number;
};

export type CoachEarnings = {
  coachId: string;
  personId: string;
  name: string;
  sessions: EarnedSession[];
  sessionCount: number;
  sessionPayCents: number;
  alaCarteCents: number;
  totalCents: number;
};

/**
 * Earned-fee breakdown for every coach (or a single coach when `coachId` is
 * given), each with the exact list of completed sessions that make up the total
 * and, for substitute coverage, the coach who was covered. Sorted by total
 * earned, highest first.
 */
export async function coachEarnings(opts?: { coachId?: string; now?: Date }): Promise<CoachEarnings[]> {
  const now = opts?.now ?? new Date();

  const [rate, coaches] = await Promise.all([
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { coachPerSessionCents: true, assistantPct: true, proCoachPerSessionCents: true } }),
    prisma.coach.findMany({
      where: opts?.coachId ? { id: opts.coachId } : {},
      select: { id: true, seasonPayCents: true, person: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);
  const defaultPerSession = rate?.coachPerSessionCents ?? COACH_PER_SESSION_CENTS;
  const assistantPct = rate?.assistantPct ?? 0.5;
  const proPerSession = rate?.proCoachPerSessionCents ?? null;
  const baseFor = (seasonPayCents: number | null) =>
    seasonPayCents && seasonPayCents > 0 ? Math.round(seasonPayCents / SESSIONS_PER_SEASON) : defaultPerSession;

  // Names for every coach (needed to resolve "covering for" even when scoped to
  // one coach — the covered PRIMARY may be a different coach).
  const allCoachNames = opts?.coachId
    ? await prisma.coach.findMany({ select: { id: true, person: { select: { firstName: true, lastName: true } } } })
    : coaches;
  const nameByCoachId = new Map(allCoachNames.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`.trim()]));

  // Practice earnings: capped at six sessions per team (make-ups / extra practices
  // never push a team past its six weeks), credited to the payable coach of that
  // week — a covering substitute, not the regular coach. Counted once delivered
  // (class over, or a paid cancellation). League/championship added below.
  const practiceSlots = await teamPracticeCoachSessions();
  const byCoach = new Map<string, EarnedSession[]>();
  for (const s of practiceSlots) {
    if (opts?.coachId && s.coachId !== opts.coachId) continue;
    if (!(s.paidIfCancelled || isSessionComplete({ date: s.date, endTime: s.endTime, status: s.status }, now))) continue;
    const base = baseFor(coaches.find((c) => c.id === s.coachId)?.seasonPayCents ?? null);
    const es: EarnedSession = {
      sessionId: s.sessionId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      teamName: s.teamName,
      role: s.role,
      coveringForName: s.role === "SUBSTITUTE" && s.coveringForCoachId ? nameByCoachId.get(s.coveringForCoachId) ?? "another coach" : null,
      payCents: coachSessionPayCents(s.role, base, assistantPct, proPerSession),
    };
    const list = byCoach.get(s.coachId) ?? [];
    list.push(es);
    byCoach.set(s.coachId, list);
  }

  // League nights (weeks 7–11) & championship (week 12) pay each team's coach a
  // session — one per team, mirroring practices — so every team a coach holds
  // totals 12 sessions ($1,200) for the season. They're not practice SessionCoach
  // rows, so they come from the per-team calendar helper; counted here once the
  // week has arrived (delivered), same as a completed practice.
  const leagueRaw = await leagueChampionshipCoachSessions();
  const leagueDeliveredByCoach = new Map<string, typeof leagueRaw>();
  for (const ls of leagueRaw) {
    if (ls.date.getTime() > now.getTime()) continue; // delivered only
    const arr = leagueDeliveredByCoach.get(ls.coachId) ?? [];
    arr.push(ls);
    leagueDeliveredByCoach.set(ls.coachId, arr);
  }

  const result: CoachEarnings[] = [];
  for (const c of coaches) {
    const base = baseFor(c.seasonPayCents);
    const league: EarnedSession[] = (leagueDeliveredByCoach.get(c.id) ?? []).map((ls) => ({
      sessionId: `lc-${c.id}-${ls.day}-${ls.role}-${ls.teamName}`,
      date: ls.date,
      startTime: ls.startTime,
      endTime: "",
      teamName: ls.teamName,
      role: ls.role,
      coveringForName: null,
      payCents: coachSessionPayCents(ls.role, base, assistantPct, proPerSession),
    }));
    const sessions = [...(byCoach.get(c.id) ?? []), ...league].sort((a, b) => b.date.getTime() - a.date.getTime());
    const sessionPayCents = sessions.reduce((s, e) => s + e.payCents, 0);
    const alaCarteCents = await alaCarteEarnedCents({ coachId: c.id, now });
    // Skip coaches who have earned nothing, unless a single coach was requested
    // (then always return their row so the page can show a real $0).
    if (!opts?.coachId && sessions.length === 0 && alaCarteCents === 0) continue;
    result.push({
      coachId: c.id,
      personId: c.person.id,
      name: `${c.person.firstName} ${c.person.lastName}`.trim(),
      sessions,
      sessionCount: sessions.length,
      sessionPayCents,
      alaCarteCents,
      totalCents: sessionPayCents + alaCarteCents,
    });
  }
  result.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
  return result;
}
