import "server-only";
import { prisma } from "@/lib/db";

// Academy & League stats for the active season(s). Everything here is derived
// from live data — no manual entry. Season-scoped where a season applies;
// league stats come from the ACP fixtures.

const DEAD_REG = ["WITHDRAWN", "DUPLICATE", "MERGED"];

/** Minutes between two "HH:MM" times (same day). */
function minutesBetween(start: string, end: string): number {
  const p = (t: string) => { const [h, m] = t.split(":").map((x) => parseInt(x, 10)); return (h || 0) * 60 + (m || 0); };
  const d = p(end) - p(start);
  return d > 0 ? d : 0;
}

export type StatValue = { label: string; value: string; sub?: string };
export type StatGroup = { title: string; stats: StatValue[] };
export type CoachHours = { name: string; hours: number; sessions: number };
export type RatingsSummary = { count: number; avg: number; reviews: number; published: number; dist: number[] };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const num = (n: number) => n.toLocaleString("en-US");
/** Hours from minutes, one decimal, trimmed (90 → "1.5", 120 → "2"). */
const hrs = (minutes: number) => {
  const h = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

export async function academyStats(): Promise<{
  groups: StatGroup[];
  seasonNames: string[];
  coachLeaderboard: CoachHours[];
  ratings: RatingsSummary;
}> {
  const seasons = await prisma.season.findMany({ where: { active: true, isTest: false }, select: { id: true, name: true, program: true } });
  const seasonIds = seasons.map((s) => s.id);
  const acpSeasonIds = seasons.filter((s) => s.program === "ACP").map((s) => s.id);

  const empty: RatingsSummary = { count: 0, avg: 0, reviews: 0, published: 0, dist: [0, 0, 0, 0, 0] };
  if (seasonIds.length === 0) {
    return { groups: [], seasonNames: [], coachLeaderboard: [], ratings: empty };
  }

  const [regs, teams, coachStaff, sessions, attendance, fixtures, payments, apparel, feedback, lessons, alaBookings] = await Promise.all([
    prisma.registration.findMany({ where: { seasonId: { in: seasonIds }, status: { notIn: DEAD_REG } }, select: { personId: true, createdAt: true, person: { select: { waiverSignedAt: true } } } }),
    prisma.team.findMany({ where: { seasonId: { in: seasonIds }, isTest: false }, select: { id: true, divisionId: true, facilityId: true, coachId: true, _count: { select: { members: true } }, assistantCoaches: { select: { coachId: true } } } }),
    prisma.coach.findMany({ select: { id: true, person: { select: { firstName: true, lastName: true } } } }),
    prisma.session.findMany({ where: { seasonId: { in: seasonIds } }, select: { id: true, type: true, status: true, startTime: true, endTime: true, facilityId: true, coaches: { select: { coachId: true } } } }),
    prisma.attendance.findMany({ where: { session: { seasonId: { in: seasonIds } } }, select: { status: true } }),
    acpSeasonIds.length ? prisma.fixture.findMany({ where: { homeTeam: { seasonId: { in: acpSeasonIds } } }, select: { status: true, homeTeamId: true, awayTeamId: true } }) : Promise.resolve([]),
    prisma.payment.findMany({ where: { seasonId: { in: seasonIds }, direction: "IN" }, select: { status: true, amountCents: true } }),
    prisma.apparelOrderItem.count({ where: { payment: { seasonId: { in: seasonIds } } } }),
    prisma.feedback.findMany({ select: { published: true, rating: true, body: true } }),
    prisma.lessonRequest.count(),
    prisma.alaCarteBooking.count(),
  ]);

  // People
  const enrolledIds = new Set(regs.map((r) => r.personId));
  const enrolled = enrolledIds.size;
  const waiverSigned = new Set(regs.filter((r) => r.person?.waiverSignedAt).map((r) => r.personId)).size;
  const divisions = new Set(teams.map((t) => t.divisionId).filter(Boolean)).size;
  const rosterTotal = teams.reduce((a, t) => a + t._count.members, 0);
  const avgRoster = teams.length ? Math.round((rosterTotal / teams.length) * 10) / 10 : 0;
  const coachIds = new Set<string>();
  for (const t of teams) { if (t.coachId) coachIds.add(t.coachId); for (const a of t.assistantCoaches) coachIds.add(a.coachId); }

  // Locations
  const facilityIds = new Set<string>();
  for (const t of teams) if (t.facilityId) facilityIds.add(t.facilityId);
  for (const s of sessions) if (s.facilityId) facilityIds.add(s.facilityId);

  // Coaching hours = each delivered session's length credited once to every
  // coach on it (two coaches on a 90-min practice = 3 coach-hours). The total is
  // exactly the sum of the per-coach leaderboard below.
  const coachMinutes = new Map<string, number>();
  const coachSessions = new Map<string, number>();
  let coachingMinutes = 0;
  let practiceDelivered = 0;
  let practiceScheduled = 0;
  for (const s of sessions) {
    if (s.type === "PRACTICE") { practiceScheduled += 1; if (s.status === "DELIVERED") practiceDelivered += 1; }
    if (s.status === "DELIVERED") {
      const mins = minutesBetween(s.startTime, s.endTime);
      for (const c of s.coaches) {
        coachMinutes.set(c.coachId, (coachMinutes.get(c.coachId) ?? 0) + mins);
        coachSessions.set(c.coachId, (coachSessions.get(c.coachId) ?? 0) + 1);
        coachingMinutes += mins;
      }
    }
  }
  const coachName = new Map(coachStaff.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`.trim()]));
  const coachLeaderboard: CoachHours[] = [...coachMinutes.entries()]
    .map(([id, mins]) => ({ name: coachName.get(id) ?? "Unknown coach", hours: Math.round((mins / 60) * 10) / 10, sessions: coachSessions.get(id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours || b.sessions - a.sessions || a.name.localeCompare(b.name));

  // Attendance
  const checkins = attendance.length;
  const present = attendance.filter((a) => a.status === "PRESENT").length;
  const attRate = checkins ? Math.round((present / checkins) * 100) : 0;

  // League
  const matchesPlayed = fixtures.filter((f) => f.status === "COMPLETED").length;
  const matchesTotal = fixtures.length;
  const leagueTeamIds = new Set<string>();
  for (const f of fixtures) { if (f.homeTeamId) leagueTeamIds.add(f.homeTeamId); if (f.awayTeamId) leagueTeamIds.add(f.awayTeamId); }

  // Money
  const collected = payments.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amountCents, 0);
  const outstanding = payments.filter((p) => ["REQUESTED", "PENDING"].includes(p.status)).reduce((a, p) => a + p.amountCents, 0);
  const refunded = payments.filter((p) => p.status === "REFUNDED").reduce((a, p) => a + p.amountCents, 0);

  // Ratings & reviews (aggregate — no NPS; the "why" lives in the review text).
  const dist = [0, 0, 0, 0, 0];
  let ratingSum = 0;
  let ratingCount = 0;
  for (const f of feedback) {
    if (typeof f.rating === "number" && f.rating >= 1 && f.rating <= 5) { dist[f.rating - 1] += 1; ratingSum += f.rating; ratingCount += 1; }
  }
  const ratings: RatingsSummary = {
    count: ratingCount,
    avg: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
    reviews: feedback.filter((f) => f.body && f.body.trim().length > 0).length,
    published: feedback.filter((f) => f.published).length,
    dist,
  };

  const groups: StatGroup[] = [
    {
      title: "Money",
      stats: [
        { label: "Collected", value: usd(collected) },
        { label: "Outstanding", value: usd(outstanding) },
        { label: "Refunded", value: usd(refunded) },
      ],
    },
    {
      title: "People",
      stats: [
        { label: "Players enrolled", value: num(enrolled) },
        { label: "Teams", value: num(teams.length), sub: divisions ? `${divisions} division${divisions === 1 ? "" : "s"}` : undefined },
        { label: "Coaches this season", value: num(coachIds.size), sub: `${num(coachStaff.length)} total on staff` },
        { label: "Locations used", value: num(facilityIds.size) },
        { label: "Waivers signed", value: enrolled ? `${Math.round((waiverSigned / enrolled) * 100)}%` : "—", sub: `${num(waiverSigned)} of ${num(enrolled)}` },
        { label: "Avg roster size", value: avgRoster ? String(avgRoster) : "—" },
      ],
    },
    {
      title: "Coaching",
      stats: [
        { label: "Total coaching hours", value: hrs(coachingMinutes), sub: "delivered sessions × coaches on them" },
        { label: "Practices delivered", value: num(practiceDelivered), sub: `of ${num(practiceScheduled)} scheduled` },
        { label: "Attendance check-ins", value: num(checkins) },
        { label: "Attendance rate", value: checkins ? `${attRate}%` : "—", sub: `${num(present)} present` },
      ],
    },
    {
      title: "League",
      stats: [
        { label: "Matches played", value: num(matchesPlayed), sub: matchesTotal ? `of ${num(matchesTotal)} scheduled` : undefined },
        { label: "Matches remaining", value: num(Math.max(0, matchesTotal - matchesPlayed)) },
        { label: "Teams competing", value: num(leagueTeamIds.size) },
      ],
    },
    {
      title: "Engagement",
      stats: [
        { label: "Lessons & clinics booked", value: num(lessons + alaBookings) },
        { label: "Apparel items ordered", value: num(apparel) },
      ],
    },
  ];

  return { groups, seasonNames: seasons.map((s) => s.name), coachLeaderboard, ratings };
}
