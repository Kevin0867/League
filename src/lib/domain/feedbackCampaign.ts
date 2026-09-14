import "server-only";
import { dispatchMessage } from "@/lib/messaging";
import { signFeedbackToken } from "@/lib/domain/feedback";
import { appUrl } from "@/lib/stripe";

// Send the thank-you + no-login feedback link to a set of people. Shared by the
// admin campaign buttons, the per-team request, and the automated mid-season
// send. Each recipient gets a token scoped to them, the season, and the phase
// (and optionally a coach to pre-select on the form).
export async function sendFeedbackCampaign(opts: {
  senderId: string | null;
  seasonId: string;
  phase: string; // MIDSEASON | ENDSEASON | GENERAL
  personIds: string[];
  coachId?: string | null;
}): Promise<number> {
  const phaseWord =
    opts.phase === "MIDSEASON" ? "how the season is going"
    : opts.phase === "ENDSEASON" ? "the Fall season"
    : "your experience";

  let sent = 0;
  for (const personId of [...new Set(opts.personIds)]) {
    const token = await signFeedbackToken(personId, opts.seasonId, opts.phase, opts.coachId ?? null);
    const link = `${appUrl()}/feedback/${token}`;
    const res = await dispatchMessage({
      senderId: opts.senderId,
      seasonId: opts.seasonId,
      audienceType: "SINGLE_PERSON",
      audienceRef: personId,
      channels: ["EMAIL", "SMS"],
      triggerType: "SEASON_FEEDBACK",
      subject: "Thank you for a great season — a quick favor?",
      body: `Thank you for being part of the PURE Academy Fall Season! We'd love your quick feedback on ${phaseWord} — and if a coach made a difference, a testimonial we might feature on their profile. It takes a minute: ${link}`,
      smsBody: `PURE Academy — thank you for a great season! A quick note on ${phaseWord} (and your coach) would mean a lot: ${link}`,
    }).catch(() => ({ failures: 1 } as { failures: number }));
    if (!(res as { failures?: number }).failures) sent++;
  }
  return sent;
}
