import "server-only";
import { prisma } from "@/lib/db";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { sendResetLinkForPerson } from "@/lib/domain/passwordResetSend";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { ageFromDob } from "@/lib/domain/messaging-acl";
import { openSpotsFor, notifySubJoined } from "@/lib/domain/teamCalendar";
import { formatSessionDay, formatTime12 } from "@/lib/time";

// A member of the public claims an open substitute spot for one practice. No
// charge. They're added to the team for that date only, sent a waiver so they're
// cleared to play, and get a confirmation with directions; the coach + team are
// notified. They also receive the normal practice reminders (session-reminders
// cron includes session subs).

export type ClaimSubResult = { ok: true; personId: string; teamName: string } | { ok: false; reason: "full" | "notfound" | "fields" };

export async function claimPracticeSub(opts: {
  sessionId: string; teamId: string; firstName: string; lastName: string; email: string | null; phone: string | null; dob: Date | null;
}): Promise<ClaimSubResult> {
  const { sessionId, teamId } = opts;
  const first = opts.firstName.trim();
  const last = opts.lastName.trim();
  const email = opts.email?.trim().toLowerCase() || null;
  const phone = opts.phone?.trim() || null;
  if (!first || !last || (!email && !phone)) return { ok: false, reason: "fields" };

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true, date: true, startTime: true,
      teams: { select: { teamId: true } },
      facility: { select: { name: true, exactAddress: true, generalArea: true, crossStreets: true, isPrivate: true } },
    },
  });
  if (!session || !session.teams.some((t) => t.teamId === teamId)) return { ok: false, reason: "notfound" };
  if ((await openSpotsFor(sessionId)) <= 0) return { ok: false, reason: "full" };

  const dob = opts.dob;
  const age = dob && !isNaN(dob.getTime()) ? ageFromDob(dob) : null;

  let personId: string;
  try {
    personId = await prisma.$transaction(async (tx) => {
      const existing = email ? await tx.person.findFirst({ where: { email, NOT: { isMinor: true } }, select: { id: true } }) : null;
      const pid = existing
        ? existing.id
        : (await tx.person.create({ data: { firstName: first, lastName: last, email, phone, dob: dob && !isNaN(dob.getTime()) ? dob : null, isMinor: age !== null ? age < 18 : false }, select: { id: true } })).id;
      if (existing && phone) await tx.person.update({ where: { id: pid }, data: { phone } });
      await tx.sessionSub.upsert({ where: { sessionId_personId: { sessionId, personId: pid } }, create: { sessionId, personId: pid, teamId }, update: {} });
      return pid;
    });
  } catch {
    return { ok: false, reason: "full" };
  }

  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  const teamName = team?.name ?? "the team";
  const dayText = formatSessionDay(session.date, "long");
  const when = `${dayText} at ${formatTime12(session.startTime)}`;

  // Waiver so they're cleared to play (best-effort).
  try {
    const token = await signWaiverToken(personId);
    const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
    const em = waiverRequestEmail({ name: first, link, isMinor: age !== null ? age < 18 : false });
    if (email) await sendEmail(email, em.subject, em.text, em.html).catch(() => {});
    if (phone) await sendSms(phone, `PURE Academy — you're subbing in! Please complete this quick participation waiver so you're cleared to play: ${link}`).catch(() => {});
  } catch { /* best-effort */ }
  await sendResetLinkForPerson(personId).catch(() => {});

  // First confirmation to the sub — thanks + directions.
  const f = session.facility;
  const address = f?.exactAddress || f?.crossStreets || f?.generalArea || null;
  const directions = address ? ` Directions: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
  const where = f?.name && !f.isPrivate ? ` at ${f.name}` : f?.crossStreets ? ` near ${f.crossStreets}` : "";
  const confirm = `Thanks for joining the ${teamName} on ${when}${where}! You'll get the normal practice reminders so you know exactly where to go.${directions} If for some reason you can't make it, please let your coach know. Log in to your PURE portal any time for team info.`;
  if (phone) await sendSms(phone, confirm).catch(() => {});
  if (email) await sendEmail(email, `You're subbing in — ${teamName}`, confirm).catch(() => {});

  // Notify the coach + the team.
  await notifySubJoined(sessionId, teamId, `${first} ${last}`.trim()).catch(() => {});

  return { ok: true, personId, teamName };
}
