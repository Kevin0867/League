import "server-only";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/stripe";
import { accruePlayerSeasonFee } from "@/lib/payments/familyFee";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { teamLaunchEmail } from "@/lib/domain/launchEmail";
import { describeTeamPractice } from "@/lib/domain/practiceInfo";
import { dispatchMessage } from "@/lib/messaging";

// The "Send all" welcome — one combined email/SMS to a player's household:
// welcome + team details (if placed) + pay the season fee + pick apparel +
// complete the waiver (if unsigned). Shared by the manual "Send all" action and
// the automatic send when a player is first placed on a team.
//
// GUARANTEES the season-fee invoice exists (accrues it unless the registration
// is fee-waived), so the pay link in the email always works — this is the
// belt-and-suspenders answer to "what if an invoice wasn't created on placement":
// the welcome send creates it.

export async function sendTeamLaunch(opts: { personId: string; seasonId: string; senderId?: string | null }): Promise<{ ok: boolean; invoiceId: string | null }> {
  const { personId, seasonId, senderId = null } = opts;
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return { ok: false, invoiceId: null };

  const reg = await prisma.registration.findFirst({ where: { personId, seasonId }, select: { feeWaived: true } });

  const teamIds = (await prisma.team.findMany({ where: { seasonId }, select: { id: true } })).map((t) => t.id);
  const membership = teamIds.length
    ? await prisma.teamMember.findFirst({
        where: { personId, teamId: { in: teamIds } },
        include: { team: { include: { facility: true, coach: { include: { person: true } } } } },
      })
    : null;
  const team = membership?.team ?? null;

  const rate = await prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" } });
  const feeCents = rate?.seasonFeeCents ?? 49500;
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  const seasonName = season?.name ?? "Season";
  const payerId = person.guardianId ?? person.id;

  // Guarantee the fee invoice (unless fee-waived) so the pay link works.
  const res = reg?.feeWaived ? null : await accruePlayerSeasonFee({ playerId: person.id, seasonId, feeCents, seasonName });
  const payUrl = res ? `${appUrl()}/pay/${res.paymentId}` : null;

  const payer = await prisma.person.findUnique({ where: { id: payerId } });
  if (!payer) return { ok: false, invoiceId: res?.paymentId ?? null };

  const coachName = team?.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "your team contact";
  const coachContact = team?.coach ? [team.coach.person.email, team.coach.person.phone].filter(Boolean).join(" · ") || null : null;
  const practiceWhen = team ? await describeTeamPractice(team, seasonId) : "To be confirmed";
  // Always include the waiver link so anyone unsigned is caught.
  const waiverUrl = `${appUrl()}/waiver/sign?token=${encodeURIComponent(await signWaiverToken(payerId))}`;

  const email = teamLaunchEmail({
    recipientName: payer.firstName,
    teamName: team?.name ?? "PURE Academy",
    players: [`${person.firstName} ${person.lastName}`],
    coachName,
    coachContact,
    locationName: team?.facility?.name ?? "To be confirmed",
    locationAddress: team?.facility?.exactAddress ?? team?.facility?.generalArea ?? null,
    practiceWhen,
    payUrl: payUrl ?? `${appUrl()}/portal`,
    feeCents,
    waiverUrl,
  });
  const smsBody = `PURE Academy — welcome${team ? ` to ${team.name}` : ""}! ${team ? `Practices: ${practiceWhen}. ` : ""}${payUrl ? `Pick your team apparel & pay the season fee here: ${payUrl} ` : ""}Full details + your waiver are in your email.`;

  await dispatchMessage({
    senderId,
    seasonId,
    audienceType: "SINGLE_PERSON",
    audienceRef: payerId,
    channels: ["IN_APP", "EMAIL", "SMS"],
    triggerType: "TEAM_LAUNCH",
    subject: email.subject,
    body: email.text,
    html: email.html,
    smsBody,
  });
  return { ok: true, invoiceId: res?.paymentId ?? null };
}
