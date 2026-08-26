import "server-only";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";
import { formatCents } from "@/lib/money";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Whole-dollar amounts read cleaner without the ".00" ("$495", "$25"); anything
// with cents keeps the full currency format.
function usd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents);
}

/** Default payment deadline shown in placement/launch emails (Academy). */
export const PAYMENT_DUE_LABEL = "September 1";

/**
 * The single "team launch" email — one message to a player/guardian that folds
 * together everything they need to do: welcome + team details, pick apparel &
 * pay the season fee, and (when still outstanding) complete the waiver. Sent
 * instead of three separate emails. Each CTA deep-links to the same page the
 * individual sends use.
 */
export function teamLaunchEmail(opts: {
  recipientName: string;
  teamName: string;
  players: string[];
  coachName: string;
  coachContact: string | null;
  locationName: string;
  locationAddress: string | null;
  practiceWhen: string;
  payUrl: string;
  feeCents: number;
  apparelCents?: number;
  paymentDueLabel?: string;
  waiverUrl: string | null;
}): { subject: string; text: string; html: string } {
  const apparelCents = opts.apparelCents ?? 2500;
  const dueLabel = opts.paymentDueLabel ?? PAYMENT_DUE_LABEL;

  const detailRow = (label: string, value: string) =>
    `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;width:90px">${label}</td>` +
    `<td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td></tr>`;

  const contentHtml =
    // Team details
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:18px">` +
    `<table style="width:100%;border-collapse:collapse">` +
    detailRow("Team", esc(opts.teamName)) +
    detailRow("Coach", opts.coachContact ? `${esc(opts.coachName)}<br><span style="font-weight:400;color:#64748b;font-size:13px">${esc(opts.coachContact)}</span>` : esc(opts.coachName)) +
    detailRow("Location", opts.locationAddress ? `${esc(opts.locationName)}<br><span style="font-weight:400;color:#64748b;font-size:13px">${esc(opts.locationAddress)}</span>` : esc(opts.locationName)) +
    detailRow("Practice", esc(opts.practiceWhen)) +
    `</table></div>` +
    // Choose apparel + pay
    `<p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a">Choose Team Apparel &amp; Pay</p>` +
    `<p style="margin:0 0 12px;font-size:14px;color:#475569">Choose one PURE Academy team T-shirt or tank top (${usd(apparelCents)}), select your size, and pay your ${usd(opts.feeCents)} season fee in one checkout.</p>` +
    `<div>${emailButton(opts.payUrl, "Choose Team Apparel &amp; Pay", { primary: true })}</div>` +
    // Participation waiver — always included so anyone who hasn't signed is caught.
    (opts.waiverUrl
      ? `<p style="margin:20px 0 6px;font-size:16px;font-weight:700;color:#0f172a">Participation Waiver</p>` +
        `<p style="margin:0 0 12px;font-size:14px;color:#475569">If you haven&apos;t completed your participation waiver yet, click below to sign it — <span style="text-decoration:underline">it&apos;s required before the first practice</span>.</p>` +
        `<div>${emailButton(opts.waiverUrl, "Complete the waiver")}</div>`
      : "") +
    `<p style="margin:22px 0 0;font-size:13px;color:#64748b">Questions? Contact us at <a href="mailto:${SUPPORT_ADDRESS}" style="color:#4338ca;text-decoration:none">${SUPPORT_ADDRESS}</a>.</p>`;

  const text = [
    `You've been placed on ${opts.teamName}. Please complete payment as soon as possible, and no later than ${dueLabel}, to confirm your spot on the team.`,
    ``,
    `Team: ${opts.teamName}`,
    `Coach: ${opts.coachName}${opts.coachContact ? ` (${opts.coachContact})` : ""}`,
    `Location: ${opts.locationName}${opts.locationAddress ? ` — ${opts.locationAddress}` : ""}`,
    `Practice: ${opts.practiceWhen}`,
    ``,
    `Choose Team Apparel & Pay — one PURE Academy T-shirt or tank top (${usd(apparelCents)}), select your size, and pay your ${usd(opts.feeCents)} season fee in one checkout:`,
    `   ${opts.payUrl}`,
    ...(opts.waiverUrl
      ? [``, `Participation waiver — if you haven't completed yours yet, sign it here (required before the first practice):`, `   ${opts.waiverUrl}`]
      : []),
    ``,
    `Questions? Contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: `Welcome to PURE Academy — you're on ${opts.teamName}`,
    text,
    html: brandedEmailHtml({
      heading: `Welcome to PURE Academy!`,
      intro: `Hi ${opts.recipientName} — you've been placed on ${esc(opts.teamName)}. Please complete payment as soon as possible, and no later than ${dueLabel}, to confirm your spot on the team.`,
      contentHtml,
    }),
  };
}
