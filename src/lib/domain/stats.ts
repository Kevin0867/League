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

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const num = (n: number) => n.toLocaleString("en-US");

export async function academyStats(): Promise<{ groups: StatGroup[]; seasonNames: string[] }> {
  const seasons = await prisma.season.findMany({ where: { active: true, isTest: false }, select: { id: true, name: true, program: true } });
  const seasonIds = seasons.map((s) => s.id);
  const acpSeasonIds = seasons.filter((s) => s.program === "ACP").map((s) => s.id);

  if (seasonIds.length === 0) {
    return { groups: [], seasonNames: [] };
  }

  const [regs, teams, coaches, sessions, attendance, fixtures, payments, apparel, feedback, lessons, alaBookings] = await Promise.all([
    prisma.registration.findMany({ where: { seasonId: { in: seasonIds }, status: { notIn: DEAD_REG } }, select: { personId: true, createdAt: true, person: { select: { waiverSignedAt: true } } } }),
    prisma.team.findMany({ where: { seasonId: { in: seasonIds }, isTest: false }, select: { id: true, divisionId: true, facilityId: true, coachId: true, _count: { select: { members: true } }, assistantCoaches: { select: { coachId: true } } } }),
    prisma.coach.count(),
    prisma.session.findMany({ where: { seasonId: { in: seasonIds } }, select: { id: true, type: true, status: true, startTime: true, endTime: true, facilityId: true, coaches: { select: { coachId: true } } } }),
    prisma.attendance.findMany({ where: { session: { seasonId: { in: seasonIds } } }, select: { status: true } }),
    acpSeasonIds.length ? prisma.fixture.findMany({ where: { homeTeam: { seasonId: { in: acpSeasonIds } } }, select: { status: true, homeTeamId: true, awayTeamId: true } }) : Promise.resolve([]),
    prisma.payment.findMany({ where: { seasonId: { in: seasonIds }, direction: "IN" }, select: { status: true, amountCents: true } }),
    prisma.apparelOrderItem.count({ where: { payment: { seasonId: { in: seasonIds } } } }),
    prisma.feedback.findMany({ select: { published: true } }),
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

  // Coaching hours delivered = Σ (session length × coaches) for delivered sessions.
  let coachingMinutes = 0;
  let practiceDelivered = 0;
  let practiceScheduled = 0;
  for (const s of sessions) {
    if (s.type === "PRACTICE") { practiceScheduled += 1; if (s.status === "DELIVERED") practiceDelivered += 1; }
    if (s.status === "DELIVERED") {
      const coachN = Math.max(1, s.coaches.length);
      coachingMinutes += minutesBetween(s.startTime, s.endTime) * coachN;
    }
  }
  const coachingHours = Math.round(coachingMinutes / 60);

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

  // Engagement
  const testimonials = feedback.filter((f) => f.published).length;

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
        { label: "Coaches this season", value: num(coachIds.size), sub: `${num(coaches)} total on staff` },
        { label: "Locations used", value: num(facilityIds.size) },
        { label: "Waivers signed", value: enrolled ? `${Math.round((waiverSigned / enrolled) * 100)}%` : "—", sub: `${num(waiverSigned)} of ${num(enrolled)}` },
        { label: "Avg roster size", value: avgRoster ? String(avgRoster) : "—" },
      ],
    },
    {
      title: "Coaching",
      stats: [
        { label: "Coaching hours delivered", value: num(coachingHours), sub: "hours × coaches, delivered sessions" },
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
        { label: "Testimonials published", value: num(testimonials), sub: `${num(feedback.length)} feedback total` },
      ],
    },
  ];

  return { groups, seasonNames: seasons.map((s) => s.name) };
}
