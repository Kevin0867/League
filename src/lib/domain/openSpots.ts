import "server-only";
import { prisma } from "@/lib/db";
import { TEAM_CAP } from "@/lib/enums";
import { formatTime12 } from "@/lib/time";
import { sendEmail } from "@/lib/notify";
import { dispatchMessage } from "@/lib/messaging";
import { describeTeamPractice } from "@/lib/domain/practiceInfo";
import { appUrl } from "@/lib/stripe";

// The public "Open Spots" marketing page and its plumbing. A team is advertised
// only when an admin checks "Make spots available" (Team.acceptingSignups) and
// it still has room (roster < capacity). Signups run the existing register →
// waiver → apparel → pay funnel; the recruit is placed on the team when their
// payment clears (auto-assign on payment), or held for admin review if the last
// spot filled while they were paying.

const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL ?? "team@purepickleball.com";

export const OPEN_SPOTS_COPY_KEYS = { headline: "openSpotsHeadline", intro: "openSpotsIntro" } as const;
export const DEFAULT_OPEN_SPOTS_COPY = {
  headline: "Open spots — join a PURE Academy team",
  intro: "These teams have room right now. Pick one to sign up, sign the waiver, choose your apparel, and pay — you'll be on the team as soon as your payment clears.",
};

export async function getOpenSpotsCopy(): Promise<{ headline: string; intro: string }> {
  const rows = await prisma.siteContent
    .findMany({ where: { key: { in: [OPEN_SPOTS_COPY_KEYS.headline, OPEN_SPOTS_COPY_KEYS.intro] } } })
    .catch(() => []);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    headline: byKey[OPEN_SPOTS_COPY_KEYS.headline] || DEFAULT_OPEN_SPOTS_COPY.headline,
    intro: byKey[OPEN_SPOTS_COPY_KEYS.intro] || DEFAULT_OPEN_SPOTS_COPY.intro,
  };
}

/** Admin-set target size for a team, falling back to the standard cap. */
export function teamCapacity(capacity: number | null | undefined): number {
  return capacity && capacity > 0 ? capacity : TEAM_CAP;
}

export type OpenSpotTeam = {
  id: string;
  name: string;
  category: string | null;
  dayTime: string | null;
  location: string | null;
  capacity: number;
  roster: number;
  spotsLeft: number;
};

/** The teams to show — either only those with room (public page) or all
 *  signup-enabled teams (admin manager, so they can see full ones too). */
export async function listOpenSpotTeams(seasonId: string, opts?: { includeFull?: boolean }): Promise<OpenSpotTeam[]> {
  const teams = await prisma.team.findMany({
    where: { seasonId, club: "PURE", isTest: false, acceptingSignups: true },
    select: {
      id: true, name: true, divisionCode: true, levelBand: true, market: true,
      dayOfWeek: true, startTime: true, coachPlays: true, capacity: true,
      facility: { select: { name: true } },
      _count: { select: { members: true } },
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });
  const rows = teams.map((t) => {
    const capacity = teamCapacity(t.capacity);
    const roster = t._count.members + (t.coachPlays ? 1 : 0);
    return {
      id: t.id,
      name: t.name,
      category: t.divisionCode || t.levelBand || null,
      dayTime: t.dayOfWeek && t.startTime ? `${t.dayOfWeek} ${formatTime12(t.startTime)}` : null,
      location: [t.facility?.name, t.market].filter(Boolean).join(" · ") || null,
      capacity,
      roster,
      spotsLeft: Math.max(0, capacity - roster),
    };
  });
  return opts?.includeFull ? rows : rows.filter((r) => r.spotsLeft > 0);
}

/** Place a paid open-spots recruit on the team they signed up for. Called from
 *  every payment-completion point; idempotent (skips if already a member) and
 *  never throws. If the team filled while they were paying, hold for admin
 *  review and email the team inbox instead of overselling. */
export async function placeTeamRecruitForPayment(paymentId: string): Promise<void> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { seasonId: true, partyId: true, coveredPersonIds: true },
    });
    if (!payment) return;
    const seasonId = payment.seasonId;
    if (!seasonId) return;
    const covered = Array.isArray(payment.coveredPersonIds) ? (payment.coveredPersonIds as unknown[]) : [];
    const personIds = (covered.length ? covered : payment.partyId ? [payment.partyId] : [])
      .map((x) => String(x))
      .filter(Boolean);

    for (const personId of personIds) {
      const reg = await prisma.registration.findFirst({
        where: { personId, seasonId: seasonId, targetTeamId: { not: null } },
        select: { id: true, targetTeamId: true },
      });
      if (!reg?.targetTeamId) continue;

      const team = await prisma.team.findUnique({
        where: { id: reg.targetTeamId },
        select: { id: true, name: true, coachPlays: true, capacity: true, acceptingSignups: true, _count: { select: { members: true } } },
      });
      if (!team) continue;

      const already = await prisma.teamMember.findUnique({
        where: { teamId_personId: { teamId: team.id, personId } },
      });
      if (already) continue; // idempotent — already placed

      const cap = teamCapacity(team.capacity);
      const roster = team._count.members + (team.coachPlays ? 1 : 0);
      if (roster >= cap) {
        await holdForReview(personId, team.id, team.name, seasonId);
        continue;
      }

      await prisma.teamMember.create({ data: { teamId: team.id, personId, roleOnTeam: "PLAYER" } });
      await prisma.registration.updateMany({
        where: { personId, seasonId: seasonId, status: { not: "ASSIGNED" } },
        data: { status: "ASSIGNED" },
      });
      await confirmPlacement(personId, team.id, seasonId);
    }
  } catch (e) {
    console.error("placeTeamRecruitForPayment failed", e);
  }
}

/** Tell a just-placed player they're confirmed on the team (they've already paid,
 *  so no pay CTA — just a warm welcome with the practice details). */
async function confirmPlacement(personId: string, teamId: string, seasonId: string): Promise<void> {
  const [person, team] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, guardianId: true } }),
    prisma.team.findUnique({ where: { id: teamId }, include: { facility: true, coach: { include: { person: true } } } }),
  ]);
  if (!person || !team) return;
  const payerId = person.guardianId ?? personId;
  const coachName = team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
  const practiceWhen = await describeTeamPractice(team, seasonId).catch(() => "To be confirmed");
  const location = team.facility?.name ?? "To be confirmed";
  const body = [
    `You're confirmed on ${team.name}! 🎉`,
    "",
    `Practices: ${practiceWhen}`,
    `Location: ${location}`,
    `Coach: ${coachName}`,
    "",
    `See your team and everything else in your portal: ${appUrl()}/portal`,
  ].join("\n");
  await dispatchMessage({
    seasonId,
    audienceType: "SINGLE_PERSON",
    audienceRef: payerId,
    channels: ["IN_APP", "EMAIL", "SMS"],
    triggerType: "TEAM_ASSIGNMENT",
    subject: `You're on ${team.name}!`,
    body,
    smsBody: `PURE Academy — you're confirmed on ${team.name}! Practices: ${practiceWhen}. Details in your portal: ${appUrl()}/portal`,
  }).catch(() => {});
}

/** The last spot filled before this payment landed — keep the paid player off
 *  the roster and alert admins so they can add a spot, place them elsewhere, or
 *  refund. */
async function holdForReview(personId: string, teamId: string, teamName: string, seasonId: string): Promise<void> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true, email: true, phone: true } });
  const who = person ? `${person.firstName} ${person.lastName}`.trim() : "A player";
  await sendEmail(
    TEAM_INBOX,
    `Open-spots signup needs review — ${teamName} was full`,
    [
      `${who} paid to join ${teamName} through the open-spots page, but the team filled up before their payment cleared, so they were NOT auto-placed.`,
      person?.email || person?.phone ? `Contact: ${[person.email, person.phone].filter(Boolean).join(" · ")}` : "",
      "",
      "Please review: add a spot and place them, move them to another team, or refund them.",
      `${appUrl()}/console/registrations`,
    ].filter(Boolean).join("\n"),
  ).catch(() => {});
}
