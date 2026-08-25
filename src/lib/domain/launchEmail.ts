import "server-only";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";
import { formatCents } from "@/lib/money";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The single "team launch" email — one message to a player/guardian that folds
 * together everything they need to do: welcome + team details, pick apparel &
 * pay the season fee, and complete the waiver. Sent instead of three separate
 * emails. Each CTA still deep-links to the same page the individual sends use.
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
  waiverUrl: string | null;
}): { subject: string; text: string; html: string } {
  const detailRow = (label: string, value: string) =>
    `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;width:90px">${label}</td>` +
    `<td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td></tr>`;

  const stepNum = (n: number) =>
    `<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:11px;background:#4338ca;color:#fff;font-size:12px;font-weight:700;margin-right:8px">${n}</span>`;

  const contentHtml =
    // Team details
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:18px">` +
    `<table style="width:100%;border-collapse:collapse">` +
    detailRow("Team", esc(opts.teamName)) +
    detailRow("Coach", opts.coachContact ? `${esc(opts.coachName)}<br><span style="font-weight:400;color:#64748b;font-size:13px">${esc(opts.coachContact)}</span>` : esc(opts.coachName)) +
    detailRow("Location", opts.locationAddress ? `${esc(opts.locationName)}<br><span style="font-weight:400;color:#64748b;font-size:13px">${esc(opts.locationAddress)}</span>` : esc(opts.locationName)) +
    detailRow("Practice", esc(opts.practiceWhen)) +
    `</table></div>` +
    // Step 1 — apparel + fee
    `<p style="margin:0 0 6px;font-size:15px;color:#0f172a">${stepNum(1)}<strong>Pick your team apparel &amp; pay</strong></p>` +
    `<p style="margin:0 0 10px 30px;font-size:13px;color:#64748b">Each player chooses one team T-shirt or tank top (style &amp; size), then pays the ${formatCents(opts.feeCents)} season fee and apparel together in one secure checkout.</p>` +
    `<div style="margin-left:30px">${emailButton(opts.payUrl, "Choose apparel &amp; pay", { primary: true })}</div>` +
    // Step 2 — waiver (only if needed)
    (opts.waiverUrl
      ? `<p style="margin:18px 0 6px;font-size:15px;color:#0f172a">${stepNum(2)}<strong>Complete the participation waiver</strong></p>` +
        `<p style="margin:0 0 10px 30px;font-size:13px;color:#64748b">Required before the first practice — it only takes a minute.</p>` +
        `<div style="margin-left:30px">${emailButton(opts.waiverUrl, "Complete the waiver")}</div>`
      : "") +
    `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">The fee reserves a place on a team, not a session count. Secure checkout is hosted by Stripe — we never see your card details.</p>`;

  const text = [
    `Team: ${opts.teamName}`,
    `Coach: ${opts.coachName}${opts.coachContact ? ` (${opts.coachContact})` : ""}`,
    `Location: ${opts.locationName}${opts.locationAddress ? ` — ${opts.locationAddress}` : ""}`,
    `Practice: ${opts.practiceWhen}`,
    ``,
    `1) Pick your team apparel & pay the ${formatCents(opts.feeCents)} season fee (one checkout):`,
    `   ${opts.payUrl}`,
    ...(opts.waiverUrl ? [``, `2) Complete the participation waiver:`, `   ${opts.waiverUrl}`] : []),
    ``,
    `Any questions, contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: `Welcome to ${opts.teamName} — apparel, season fee & waiver`,
    text,
    html: brandedEmailHtml({
      heading: `Welcome to ${opts.teamName}!`,
      intro: `Hi ${opts.recipientName} — a couple of quick steps to get set for the season.`,
      contentHtml,
    }),
  };
}
