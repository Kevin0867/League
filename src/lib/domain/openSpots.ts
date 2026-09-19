import "server-only";
import { prisma } from "@/lib/db";
import { TEAM_CAP } from "@/lib/enums";
import { sendEmail, sendSms } from "@/lib/notify";
import { dispatchMessage } from "@/lib/messaging";
import { ageFromDob } from "@/lib/domain/messaging-acl";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { mintPortalAccessLink } from "@/lib/domain/passwordResetSend";
import { describeTeamPractice, dayOfWeekPlural, practiceTimeRange } from "@/lib/domain/practiceInfo";
import { teamCategoryLabel } from "@/lib/domain/teamName";
import { appUrl } from "@/lib/stripe";
import { formatSessionDay, formatTime12, phoenixDateInput } from "@/lib/time";

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

// A full team (roster at capacity) can still take a couple of players onto a
// public waitlist, so a spot that opens up has someone ready to fill it.
export const WAITLIST_CAP = 2;

export type OpenSpotTeam = {
  id: string;
  name: string;
  category: string | null;
  dayTime: string | null;
  location: string | null;
  capacity: number;
  roster: number;
  spotsLeft: number;
  full: boolean;
  waitlistCount: number;
  waitlistCap: number;
  waitlistOpen: boolean;
};

/** The teams to show — either only those with room (public page) or all
 *  signup-enabled teams (admin manager, so they can see full ones too). */
export async function listOpenSpotTeams(seasonId: string, opts?: { includeFull?: boolean }): Promise<OpenSpotTeam[]> {
  const teams = await prisma.team.findMany({
    where: { seasonId, club: "PURE", isTest: false, acceptingSignups: true },
    select: {
      id: true, name: true, club: true, color: true, divisionCode: true, levelBand: true, market: true, gender: true,
      dayOfWeek: true, startTime: true, coachPlays: true, capacity: true,
      division: { select: { name: true } },
      facility: { select: { name: true, isPrivate: true, crossStreets: true, generalArea: true } },
      _count: { select: { members: true } },
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });
  // Waitlist counts per team, so full teams can advertise waitlist availability.
  const teamIds = teams.map((t) => t.id);
  const wlCounts = teamIds.length
    ? await prisma.teamWaitlist.groupBy({ by: ["teamId"], where: { teamId: { in: teamIds } }, _count: { _all: true } })
    : [];
  const wlByTeam = new Map(wlCounts.map((w) => [w.teamId, w._count._all]));
  const rows = teams.map((t) => {
    const capacity = teamCapacity(t.capacity);
    const roster = t._count.members + (t.coachPlays ? 1 : 0);
    // For a private home never reveal the facility name (often the owner's name)
    // or street address — show the cross streets (or general area) + city only.
    const f = t.facility;
    const locationBits = f?.isPrivate
      ? [f.crossStreets || f.generalArea, t.market]
      : [f?.name, t.market];
    // Category so a family knows if they fit — prefer the team's actual division
    // label ("Men's Elite 4.5", "High School ELITE", "Elementary", "Middle"),
    // falling back to a derived label if a team has no division linked.
    const category = t.division?.name || teamCategoryLabel({ divisionCode: t.divisionCode, gender: t.gender, divisionName: t.division?.name ?? null });
    const dayTime = [dayOfWeekPlural(t.dayOfWeek), practiceTimeRange(t.startTime)].filter(Boolean).join(" · ");
    const spotsLeft = Math.max(0, capacity - roster);
    const full = spotsLeft <= 0;
    const waitlistCount = wlByTeam.get(t.id) ?? 0;
    return {
      id: t.id,
      // The admin-entered team name, shown identically here and on the signup
      // page so they always match.
      name: t.name,
      category: category || t.divisionCode || t.levelBand || null,
      dayTime: dayTime || null,
      location: locationBits.filter(Boolean).join(" · ") || null,
      capacity,
      roster,
      spotsLeft,
      full,
      waitlistCount,
      waitlistCap: WAITLIST_CAP,
      waitlistOpen: full && waitlistCount < WAITLIST_CAP,
    };
  });
  // Public page shows every team: those with open spots, plus full ones (which
  // offer the waitlist). Only drop full teams whose waitlist is also full when
  // NOT including full — the admin manager passes includeFull to see them all.
  return opts?.includeFull ? rows : rows.filter((r) => r.spotsLeft > 0 || r.waitlistOpen);
}

export type SubNeeded = {
  sessionId: string;
  teamId: string;
  teamName: string;
  category: string | null;
  type: string;
  dateLabel: string;
  timeLabel: string;
  location: string | null;
  spotsOpen: number;
};

/**
 * Upcoming practices/matches that need a substitute — a roster player marked out
 * and the spot isn't covered yet. Public-safe: it never names who's out, only the
 * team, level, date/time, location (cross streets for a private home), and how
 * many spots are open. Ordered soonest first.
 */
export async function listSubsNeeded(seasonId: string): Promise<SubNeeded[]> {
  const todayISO = phoenixDateInput(new Date());
  const from = new Date(Date.now() - 1 * 86400000);
  const sessions = await prisma.session.findMany({
    where: { seasonId, type: { in: ["PRACTICE", "LEAGUE_MATCH"] }, status: { in: ["SCHEDULED", "RESCHEDULED"] }, date: { gte: from } },
    select: {
      id: true, type: true, date: true, startTime: true,
      facility: { select: { name: true, isPrivate: true, crossStreets: true, generalArea: true } },
      teams: { include: { team: { select: { id: true, name: true, isTest: true, club: true, market: true, divisionCode: true, gender: true, levelBand: true, division: { select: { name: true } } } } } },
    },
    orderBy: { date: "asc" },
  });
  const ids = sessions.map((s) => s.id);
  const [abs, subs] = await Promise.all([
    ids.length ? prisma.playerAbsence.findMany({ where: { sessionId: { in: ids } }, select: { sessionId: true } }) : Promise.resolve([]),
    ids.length ? prisma.sessionSub.findMany({ where: { sessionId: { in: ids } }, select: { sessionId: true } }) : Promise.resolve([]),
  ]);
  const count = (rows: { sessionId: string }[]) => { const m = new Map<string, number>(); for (const r of rows) m.set(r.sessionId, (m.get(r.sessionId) ?? 0) + 1); return m; };
  const absBy = count(abs);
  const subBy = count(subs);

  const out: SubNeeded[] = [];
  for (const s of sessions) {
    if (phoenixDateInput(s.date) < todayISO) continue; // upcoming only
    const open = Math.max(0, (absBy.get(s.id) ?? 0) - (subBy.get(s.id) ?? 0));
    if (open <= 0) continue;
    const team = s.teams[0]?.team;
    if (!team || team.isTest || team.club !== "PURE") continue;
    const f = s.facility;
    const locationBits = f?.isPrivate ? [f.crossStreets || f.generalArea, team.market] : [f?.name, team.market];
    const category = team.division?.name || teamCategoryLabel({ divisionCode: team.divisionCode, gender: team.gender, divisionName: team.division?.name ?? null });
    out.push({
      sessionId: s.id,
      teamId: team.id,
      teamName: team.name,
      category: category || team.divisionCode || team.levelBand || null,
      type: s.type,
      dateLabel: formatSessionDay(s.date, "long"),
      timeLabel: formatTime12(s.startTime),
      location: locationBits.filter(Boolean).join(" · ") || null,
      spotsOpen: open,
    });
  }
  return out;
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
/** Sweep: place any open-spots recruit who has PAID but was never placed on
 *  their team — the safety net for a missed payment webhook (the live webhook
 *  places on payment; if it's missed, the paid player is stuck at "submitted"
 *  until this runs). Idempotent; safe to run every reconcile. Returns counts. */
export async function placePaidUnplacedRecruits(seasonId?: string): Promise<{ placed: number; held: number }> {
  let placed = 0;
  let held = 0;
  const regs = await prisma.registration.findMany({
    where: { targetTeamId: { not: null }, status: { not: "ASSIGNED" }, ...(seasonId ? { seasonId } : {}) },
    select: { personId: true, seasonId: true, targetTeamId: true },
  });
  if (!regs.length) return { placed, held };

  // Group by season and resolve, per season, which people have paid (or started
  // an installment/subscription) — read from the payments that cover them.
  const bySeason = new Map<string, { personId: string; teamId: string }[]>();
  for (const r of regs) {
    if (!r.seasonId || !r.targetTeamId) continue;
    if (!bySeason.has(r.seasonId)) bySeason.set(r.seasonId, []);
    bySeason.get(r.seasonId)!.push({ personId: r.personId, teamId: r.targetTeamId });
  }

  for (const [sid, items] of bySeason) {
    const payments = await prisma.payment.findMany({
      where: { seasonId: sid, direction: "IN" },
      select: { status: true, stripeSubscriptionId: true, installmentsPaid: true, partyId: true, coveredPersonIds: true },
    });
    const paidPersonIds = new Set<string>();
    for (const p of payments) {
      const isPaid = p.status === "PAID" || !!p.stripeSubscriptionId || (p.installmentsPaid ?? 0) >= 1;
      if (!isPaid) continue;
      if (p.partyId) paidPersonIds.add(p.partyId);
      const covered = Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as unknown[]) : [];
      for (const c of covered) paidPersonIds.add(String(c));
    }

    for (const it of items) {
      if (!paidPersonIds.has(it.personId)) continue;
      const already = await prisma.teamMember.findUnique({ where: { teamId_personId: { teamId: it.teamId, personId: it.personId } } });
      if (already) {
        await prisma.registration.updateMany({ where: { personId: it.personId, seasonId: sid, status: { not: "ASSIGNED" } }, data: { status: "ASSIGNED" } }).catch(() => {});
        continue;
      }
      const team = await prisma.team.findUnique({ where: { id: it.teamId }, select: { id: true, name: true, coachPlays: true, capacity: true, _count: { select: { members: true } } } });
      if (!team) continue;
      const cap = teamCapacity(team.capacity);
      const roster = team._count.members + (team.coachPlays ? 1 : 0);
      if (roster >= cap) {
        await holdForReview(it.personId, team.id, team.name, sid);
        held++;
        continue;
      }
      await prisma.teamMember.create({ data: { teamId: team.id, personId: it.personId, roleOnTeam: "PLAYER" } }).catch(() => {});
      await prisma.registration.updateMany({ where: { personId: it.personId, seasonId: sid, status: { not: "ASSIGNED" } }, data: { status: "ASSIGNED" } });
      await confirmPlacement(it.personId, team.id, sid);
      placed++;
    }
  }
  return { placed, held };
}

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

export type JoinWaitlistResult =
  | { ok: true; teamName: string; position: number }
  | { ok: false; reason: "fields" | "notfound" | "notfull" | "waitlistfull" | "already" };

/** PUBLIC: a family joins a full team's waitlist from the open-spots page. No
 *  charge, no placement — they're recorded on the team's waitlist (kept off the
 *  roster) and an admin places them when a spot opens. Guards the per-team
 *  waitlist cap, notifies the family (with their position) and the office. */
export async function joinTeamWaitlist(opts: {
  teamId: string; firstName: string; lastName: string; email: string | null; phone: string | null; dob: Date | null;
}): Promise<JoinWaitlistResult> {
  const first = opts.firstName.trim();
  const last = opts.lastName.trim();
  const email = opts.email?.trim().toLowerCase() || null;
  const phone = opts.phone?.trim() || null;
  if (!first || !last || (!email && !phone)) return { ok: false, reason: "fields" };

  const team = await prisma.team.findUnique({
    where: { id: opts.teamId },
    select: { id: true, name: true, seasonId: true, acceptingSignups: true, capacity: true, coachPlays: true, _count: { select: { members: true } } },
  });
  if (!team || !team.acceptingSignups) return { ok: false, reason: "notfound" };
  const cap = teamCapacity(team.capacity);
  const roster = team._count.members + (team.coachPlays ? 1 : 0);
  if (roster < cap) return { ok: false, reason: "notfull" }; // there's a real spot — sign up + pay instead

  const dob = opts.dob && !isNaN(opts.dob.getTime()) ? opts.dob : null;
  const age = dob ? ageFromDob(dob) : null;

  let position: number;
  let personId: string;
  try {
    const out = await prisma.$transaction(async (tx) => {
      const existing = email ? await tx.person.findFirst({ where: { email, NOT: { isMinor: true } }, select: { id: true } }) : null;
      const pid = existing
        ? existing.id
        : (await tx.person.create({ data: { firstName: first, lastName: last, email, phone, dob, isMinor: age !== null ? age < 18 : false }, select: { id: true } })).id;
      if (existing && phone) await tx.person.update({ where: { id: pid }, data: { phone } });

      // Already on the roster? Then they're not waitlisting.
      const onRoster = await tx.teamMember.findUnique({ where: { teamId_personId: { teamId: team.id, personId: pid } }, select: { teamId: true } });
      if (onRoster) throw new Error("already");
      const alreadyWaiting = await tx.teamWaitlist.findUnique({ where: { teamId_personId: { teamId: team.id, personId: pid } }, select: { id: true } });
      if (alreadyWaiting) throw new Error("already");

      const count = await tx.teamWaitlist.count({ where: { teamId: team.id } });
      if (count >= WAITLIST_CAP) throw new Error("waitlistfull");
      await tx.teamWaitlist.create({ data: { teamId: team.id, personId: pid, seasonId: team.seasonId, addedByUserId: null } });
      return { pid, position: count + 1 };
    });
    personId = out.pid;
    position = out.position;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "already") return { ok: false, reason: "already" };
    return { ok: false, reason: "waitlistfull" };
  }

  // Get them ready NOW so placement is instant if a spot opens: one link to set
  // a portal password and sign the participation waiver. Falls back to the plain
  // public waiver link if we can't mint a portal link (no email on file).
  let readyLink = `${appUrl()}/portal`;
  try {
    const token = await signWaiverToken(personId);
    const waiverPath = `/waiver/sign?token=${encodeURIComponent(token)}`;
    const combined = await mintPortalAccessLink(personId, waiverPath);
    readyLink = combined ?? `${appUrl()}${waiverPath}`;
  } catch { /* best-effort */ }

  // Confirm to the family (with position + the get-ready link), and tell the office.
  const nth = position === 1 ? "1st" : position === 2 ? "2nd" : `${position}th`;
  const familyMsg =
    `Thanks for joining the waitlist for ${team.name}! You're ${nth} in line. The team is full right now, but we'll reach out as soon as a spot opens. ` +
    `To be ready to jump in, please complete the participation waiver now — set your portal password and sign it here: ${readyLink} ` +
    `No payment is due unless a spot opens and you accept it.`;
  if (email) await sendEmail(email, `You're on the waitlist — ${team.name}`, familyMsg).catch(() => {});
  if (phone) await sendSms(phone, familyMsg).catch(() => {});
  await sendEmail(
    TEAM_INBOX,
    `New waitlist signup — ${team.name}`,
    [
      `${first} ${last} joined the waitlist for ${team.name} from the open-spots page (position ${position}).`,
      [email, phone].filter(Boolean).length ? `Contact: ${[email, phone].filter(Boolean).join(" · ")}` : "",
      "",
      `Place them from the team page when a spot opens: ${appUrl()}/console/teams/${team.id}`,
    ].filter(Boolean).join("\n"),
  ).catch(() => {});

  return { ok: true, teamName: team.name, position };
}
