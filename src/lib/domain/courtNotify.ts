import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";
import { formatDate, formatTime12, phoenixDateInput } from "@/lib/time";
import { phoenixHHMM } from "@/lib/domain/courtHold";

// There's no external court-booking system — courts are arranged directly with
// each facility. So when a lesson is booked/moved/cancelled, PURE holds the court
// internally AND emails the facility's court contact a reservation request so
// they can hold or release the court on their end. Best-effort; never blocks.

function whenLabel(scheduledAt: Date): string {
  const day = phoenixDateInput(scheduledAt);
  return `${formatDate(new Date(`${day}T12:00:00Z`))} at ${formatTime12(phoenixHHMM(scheduledAt))}`;
}

export async function notifyFacilityCourtRequest(opts: {
  facilityId: string | null | undefined;
  action: "book" | "reschedule" | "cancel";
  scheduledAt: Date;
  lengthMin: number;
  courtCount?: number;
  coachName?: string | null;
  clientName?: string | null;
  lessonTitle?: string | null;
  /** e.g. "weekly, 5 sessions" — noted so the facility can plan the block. */
  recurrence?: string | null;
  /** For a reschedule: the previous slot label. */
  prevWhen?: string | null;
}): Promise<void> {
  if (!opts.facilityId) return;
  const fac = await prisma.facility.findUnique({
    where: { id: opts.facilityId },
    select: { name: true, contactEmail: true, primaryContact: true },
  });
  if (!fac?.contactEmail) return;

  const when = whenLabel(opts.scheduledAt);
  const courts = opts.courtCount && opts.courtCount > 1 ? `${opts.courtCount} courts` : "1 court";
  const who = opts.clientName ? `for ${opts.clientName}` : "";
  const coach = opts.coachName ? ` with coach ${opts.coachName}` : "";
  const what = opts.lessonTitle || "a PURE Academy lesson";
  const greeting = fac.primaryContact ? `Hi ${fac.primaryContact.split(/\s+/)[0]},` : "Hi,";
  const sig = "\n\nThanks,\nPURE Academy";

  let subject: string, body: string;
  if (opts.action === "book") {
    subject = `Court request — ${fac.name}, ${when}`;
    body =
      `${greeting}\n\nPlease reserve ${courts} at ${fac.name} for ${what} ${who}${coach}:\n\n` +
      `• When: ${when}\n• Length: ${opts.lengthMin} min\n• Courts: ${courts}\n` +
      (opts.recurrence ? `• Recurring: ${opts.recurrence} (same day/time — we'll confirm each)\n` : "") +
      `\nPURE has this time held on our side; this is to reserve it with you. Reply if there's any conflict.${sig}`;
  } else if (opts.action === "reschedule") {
    subject = `Court change — ${fac.name}, now ${when}`;
    body =
      `${greeting}\n\n${what} ${who}${coach} has moved${opts.prevWhen ? ` (was ${opts.prevWhen})` : ""}.\n\n` +
      `• New time: ${when}\n• Length: ${opts.lengthMin} min\n• Courts: ${courts}\n\n` +
      `Please update the court reservation. If the old slot was held, it can be released.${sig}`;
  } else {
    subject = `Court release — ${fac.name}, ${when}`;
    body =
      `${greeting}\n\n${what} ${who}${coach} on ${when} has been cancelled.\n\n` +
      `Please release ${courts} for that time. Thanks for holding it.${sig}`;
  }

  await sendEmail(fac.contactEmail, subject, body).catch((e) => console.error("[court] facility notify failed", e));
}
