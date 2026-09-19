import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { TEAM_CAP } from "@/lib/enums";
import { ensureSeasonFeePayable } from "@/lib/payments/familyFee";
import { sendTeamLaunch } from "@/lib/domain/teamLaunch";

// The waitlist offer workflow. When a spot opens on a full team, the first
// person on the waitlist is OFFERED the spot with a 24-hour deadline and a
// public accept/decline link. If they accept, they're placed on the roster and
// the fee + apparel flow fires. If the 24h lapses (or they decline), the offer
// rolls to the next person. Placement itself is idempotent and one-team-per-season.

const OFFER_TTL_MS = 24 * 60 * 60 * 1000;

function capacityOf(capacity: number | null | undefined): number {
  return capacity && capacity > 0 ? capacity : TEAM_CAP;
}

async function teamRoom(teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, seasonId: true, capacity: true, coachPlays: true, _count: { select: { members: true } } },
  });
  if (!team) return null;
  const cap = capacityOf(team.capacity);
  const roster = team._count.members + (team.coachPlays ? 1 : 0);
  return { team, roster, cap, room: roster < cap };
}

/** Text + email the offered person their 24h window and accept link. */
async function notifyOffer(teamName: string, personId: string, token: string, expires: Date): Promise<void> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, email: true, phone: true } });
  if (!person) return;
  const link = `${appUrl()}/waitlist/accept?token=${token}`;
  const deadline = expires.toLocaleString("en-US", { timeZone: "America/Phoenix", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const msg = `Great news — a spot just opened on ${teamName} and you're next on the waitlist! Accept your spot here within 24 hours (by ${deadline} AZ) or it goes to the next person: ${link}`;
  if (person.email) await sendEmail(person.email, `A spot opened on ${teamName} — accept within 24 hours`, msg).catch(() => {});
  if (person.phone) await sendSms(person.phone, msg).catch(() => {});
}

/**
 * Move the waitlist forward for one team: expire any lapsed offer, then — if the
 * team has room and no active offer — offer the spot to the next waiting person.
 * Safe to call often (on roster changes and from the cron); it no-ops when there's
 * nothing to do.
 */
export async function advanceWaitlist(teamId: string): Promise<void> {
  const now = new Date();
  // Expire lapsed offers.
  const stale = await prisma.teamWaitlist.findMany({ where: { teamId, status: "OFFERED", offerExpiresAt: { lt: now } }, select: { id: true } });
  for (const s of stale) {
    await prisma.teamWaitlist.update({ where: { id: s.id }, data: { status: "EXPIRED", offerToken: null } });
  }
  // If an offer is still live, wait for it.
  const active = await prisma.teamWaitlist.findFirst({ where: { teamId, status: "OFFERED", offerExpiresAt: { gte: now } }, select: { id: true } });
  if (active) return;
  // Only offer when there's actually a spot.
  const info = await teamRoom(teamId);
  if (!info || !info.room) return;
  const next = await prisma.teamWaitlist.findFirst({ where: { teamId, status: "WAITING" }, orderBy: { createdAt: "asc" } });
  if (!next) return;
  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(now.getTime() + OFFER_TTL_MS);
  await prisma.teamWaitlist.update({ where: { id: next.id }, data: { status: "OFFERED", offeredAt: now, offerExpiresAt: expires, offerToken: token } });
  await notifyOffer(info.team.name, next.personId, token, expires).catch(() => {});
}

/** Advance every team that currently has waitlist activity — the cron entry
 *  point. Expires stale offers and rolls spots to the next person. */
export async function advanceAllWaitlists(): Promise<{ teams: number }> {
  const rows = await prisma.teamWaitlist.findMany({ where: { status: { in: ["WAITING", "OFFERED"] } }, select: { teamId: true }, distinct: ["teamId"] });
  for (const r of rows) await advanceWaitlist(r.teamId).catch(() => {});
  return { teams: rows.length };
}

/** Place a person on a team (idempotent, one-team-per-season) and fire the
 *  fee + apparel + welcome flow. Shared by accept + admin promote. */
async function placeOnTeam(personId: string, teamId: string, seasonId: string): Promise<void> {
  const seasonTeamIds = (await prisma.team.findMany({ where: { seasonId }, select: { id: true } })).map((t) => t.id);
  const otherTeamIds = seasonTeamIds.filter((tid) => tid !== teamId);
  if (otherTeamIds.length) await prisma.teamMember.deleteMany({ where: { personId, teamId: { in: otherTeamIds } } });
  await prisma.teamMember.upsert({ where: { teamId_personId: { teamId, personId } }, create: { teamId, personId, roleOnTeam: "PLAYER" }, update: {} });
  await prisma.teamWaitlist.deleteMany({ where: { teamId, personId } });
  await prisma.registration.updateMany({ where: { personId, seasonId, status: { not: "ASSIGNED" } }, data: { status: "ASSIGNED" } });
  await ensureSeasonFeePayable(personId, seasonId);
  // Fire the fee + apparel + welcome. The waiver is already done from waitlist
  // signup, so this is effectively "pay + pick apparel."
  await sendTeamLaunch({ personId, seasonId, senderId: null }).catch(() => {});
}

export type AcceptResult = { ok: true; teamName: string } | { ok: false; reason: "invalid" | "expired" | "full" };

/** The offered person accepts — place them on the team. */
export async function acceptWaitlistOffer(token: string): Promise<AcceptResult> {
  if (!token) return { ok: false, reason: "invalid" };
  const entry = await prisma.teamWaitlist.findUnique({ where: { offerToken: token } });
  if (!entry || entry.status !== "OFFERED") return { ok: false, reason: "invalid" };
  if (entry.offerExpiresAt && entry.offerExpiresAt.getTime() < Date.now()) {
    await advanceWaitlist(entry.teamId).catch(() => {});
    return { ok: false, reason: "expired" };
  }
  const info = await teamRoom(entry.teamId);
  if (!info) return { ok: false, reason: "invalid" };
  if (!info.room) return { ok: false, reason: "full" };
  await placeOnTeam(entry.personId, entry.teamId, info.team.seasonId);
  return { ok: true, teamName: info.team.name };
}

export type DeclineResult = { ok: true; teamName: string } | { ok: false; reason: "invalid" };

/** The offered person declines — release the offer and roll to the next person. */
export async function declineWaitlistOffer(token: string): Promise<DeclineResult> {
  if (!token) return { ok: false, reason: "invalid" };
  const entry = await prisma.teamWaitlist.findUnique({ where: { offerToken: token } });
  if (!entry) return { ok: false, reason: "invalid" };
  const team = await prisma.team.findUnique({ where: { id: entry.teamId }, select: { name: true } });
  if (entry.status === "OFFERED") {
    await prisma.teamWaitlist.update({ where: { id: entry.id }, data: { status: "DECLINED", offerToken: null } });
    await advanceWaitlist(entry.teamId).catch(() => {});
  }
  return { ok: true, teamName: team?.name ?? "the team" };
}

/** Look up an offer for the public accept page (no mutation). */
export async function getWaitlistOffer(token: string): Promise<
  { valid: true; teamName: string; expiresAt: Date | null; firstName: string } | { valid: false; reason: "invalid" | "expired" | "taken" }
> {
  if (!token) return { valid: false, reason: "invalid" };
  const entry = await prisma.teamWaitlist.findUnique({ where: { offerToken: token } });
  if (!entry) return { valid: false, reason: "invalid" };
  if (entry.status !== "OFFERED") return { valid: false, reason: entry.status === "EXPIRED" || entry.status === "DECLINED" ? "expired" : "taken" };
  if (entry.offerExpiresAt && entry.offerExpiresAt.getTime() < Date.now()) return { valid: false, reason: "expired" };
  const [team, person] = await Promise.all([
    prisma.team.findUnique({ where: { id: entry.teamId }, select: { name: true } }),
    prisma.person.findUnique({ where: { id: entry.personId }, select: { firstName: true } }),
  ]);
  return { valid: true, teamName: team?.name ?? "the team", expiresAt: entry.offerExpiresAt, firstName: person?.firstName ?? "" };
}
