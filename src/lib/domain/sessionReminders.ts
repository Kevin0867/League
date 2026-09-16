import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/notify";
import { formatTime12 } from "@/lib/time";
import { signCheckinToken } from "@/lib/domain/sessionCheckin";
import { appUrl } from "@/lib/stripe";

// Send the practice check-in reminder for ONE session immediately, on demand —
// the same coach + player texts the ~15-minute cron sends, but without the time
// window or the sent-once marker. Used by the "Send reminder now" button so
// staff can (re)fire a reminder with the correct production-domain link.
// Links come from appUrl() (the stable domain), never the request origin.
export async function resendSessionReminder(
  sessionId: string,
): Promise<{ ok: boolean; coachTexts: number; playerTexts: number }> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      facility: { select: { name: true } },
      teams: {
        include: {
          team: {
            select: {
              name: true,
              members: {
                select: {
                  person: {
                    select: {
                      id: true, firstName: true, phone: true, smsConsentAt: true,
                      guardian: { select: { firstName: true, phone: true, smsConsentAt: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      coaches: { select: { coachId: true } },
    },
  });
  if (!s) return { ok: false, coachTexts: 0, playerTexts: 0 };

  const origin = appUrl();
  const teamNames = s.teams.map((t) => t.team.name).join(", ") || "your class";
  const when = formatTime12(s.startTime);
  const where = s.facility ? ` · ${s.facility.name}` : "";

  // Coaches on the class.
  const coachIds = [...new Set(s.coaches.map((c) => c.coachId))];
  const coaches = coachIds.length
    ? await prisma.coach.findMany({ where: { id: { in: coachIds } }, select: { id: true, person: { select: { phone: true } } } })
    : [];
  const phoneOf = new Map(coaches.map((c) => [c.id, c.person?.phone ?? null]));

  let coachTexts = 0;
  const coachLink = `${origin}/console/schedule/${s.id}`;
  const coachBody = `PURE Academy — ${teamNames} at ${when}${where}. Open your class to check players in, add notes, and message the team: ${coachLink}`;
  for (const sc of s.coaches) {
    const phone = phoneOf.get(sc.coachId);
    if (!phone) continue;
    const res = await sendSms(phone, coachBody);
    if (res.ok) coachTexts++;
  }

  // Players + guardians who opted into SMS, deduped by phone.
  const roster = s.teams.flatMap((st) => st.team.members.map((m) => m.person));
  const sentTo = new Set<string>();
  let playerTexts = 0;
  for (const p of roster) {
    const token = await signCheckinToken(s.id, p.id);
    const link = `${origin}/checkin/${token}`;
    const recips: { phone: string; name: string }[] = [];
    // Text every number on file — SMS consent is collected at enrollment, so
    // reminders aren't gated on a per-record opt-in flag (STOP still opts out).
    if (p.phone) recips.push({ phone: p.phone, name: p.firstName });
    if (p.guardian?.phone) recips.push({ phone: p.guardian.phone, name: p.firstName });
    for (const r of recips) {
      if (sentTo.has(r.phone)) continue;
      sentTo.add(r.phone);
      const body = `PURE Academy — ${r.name}'s ${teamNames} session starts at ${when}${where}. Tap to check in when you arrive: ${link}`;
      const res = await sendSms(r.phone, body);
      if (res.ok) playerTexts++;
    }
  }

  await prisma.session.update({ where: { id: s.id }, data: { checkinReminderSentAt: new Date() } });
  return { ok: true, coachTexts, playerTexts };
}
