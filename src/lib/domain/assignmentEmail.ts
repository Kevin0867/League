import "server-only";
import { appUrl } from "@/lib/stripe";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";
import { formatCents } from "@/lib/money";

/** Default payment deadline shown in the placement email (Academy). */
const PAYMENT_DUE_LABEL = "September 1";

// Branded team placement / welcome email: "Welcome to PURE Academy!", team,
// coach, location + address, practice day/time, and — when a pay link is
// supplied — a "Choose Team Apparel & Pay" button with the season fee. Mirrors
// the team launch email so the two look the same.

function usd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents);
}

export type AssignmentDetail = {
  name: string;
  teamId: string;
  teamName: string;
  coachName: string;
  coachContact?: string | null;
  locationName: string;
  locationAddress?: string | null;
  practiceWhen: string;
  // When supplied, the email carries the apparel + season-fee checkout button.
  payUrl?: string | null;
  feeCents?: number | null;
  apparelCents?: number;
  paymentDueLabel?: string;
  // When supplied, the email carries the participation-waiver link.
  waiverUrl?: string | null;
};

function row(label: string, value: string): string {
  return (
    `<tr>` +
    `<td style="padding:7px 0;color:#64748b;font-size:13px;vertical-align:top;width:34%">${label}</td>` +
    `<td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td>` +
    `</tr>`
  );
}

export function teamAssignmentEmail(d: AssignmentDetail): {
  subject: string;
  text: string;
  html: string;
} {
  const base = appUrl();
  const dueLabel = d.paymentDueLabel ?? PAYMENT_DUE_LABEL;
  const apparelCents = d.apparelCents ?? 2500;

  const rows = [
    row("Team", d.teamName),
    row("Coach", d.coachContact ? `${d.coachName}<br><span style="font-weight:400;color:#64748b;font-size:13px">${d.coachContact}</span>` : d.coachName),
    row("Location", d.locationAddress ? `${d.locationName}<br><span style="font-weight:400;color:#64748b;font-size:13px">${d.locationAddress}</span>` : d.locationName),
    row("Practice", d.practiceWhen),
  ].join("");

  // Pay section when a checkout link is available; otherwise point to the portal.
  const payBlock = d.payUrl
    ? `<p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a">Choose Team Apparel &amp; Pay</p>` +
      `<p style="margin:0 0 12px;font-size:14px;color:#475569">Choose one PURE Academy team T-shirt or tank top (${usd(apparelCents)}), select your size, and pay your ${usd(d.feeCents ?? 49500)} season fee in one checkout.</p>` +
      `<div>${emailButton(d.payUrl, "Choose Team Apparel &amp; Pay", { primary: true })}</div>`
    : `<p style="margin:0 0 12px;font-size:14px;color:#475569">Open your portal to choose team apparel and pay your season fee.</p>` +
      `<div>${emailButton(`${base}/portal`, "Open your portal to pay", { primary: true })}</div>`;

  // Participation waiver — always included so anyone who hasn't signed is caught.
  const waiverBlock = d.waiverUrl
    ? `<p style="margin:20px 0 6px;font-size:16px;font-weight:700;color:#0f172a">Participation Waiver</p>` +
      `<p style="margin:0 0 12px;font-size:14px;color:#475569">If you haven&apos;t completed your participation waiver yet, <a href="${d.waiverUrl}" style="color:#4338ca;text-decoration:underline">click here</a> to sign it — it&apos;s required before the first practice.</p>` +
      `<div>${emailButton(d.waiverUrl, "Complete the waiver")}</div>`
    : "";

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:6px 16px;margin-bottom:16px">` +
    `<table style="width:100%;border-collapse:collapse">${rows}</table>` +
    `</div>` +
    payBlock +
    waiverBlock +
    `<p style="margin:22px 0 0;font-size:13px;color:#64748b">Questions? Contact us at <a href="mailto:${SUPPORT_ADDRESS}" style="color:#4338ca;text-decoration:none">${SUPPORT_ADDRESS}</a>.</p>`;

  const payLine = d.payUrl
    ? [`Choose Team Apparel & Pay — one PURE Academy T-shirt or tank top (${usd(apparelCents)}), select your size, and pay your ${usd(d.feeCents ?? 49500)} season fee in one checkout:`, `   ${d.payUrl}`]
    : [`Open your portal to choose team apparel and pay your season fee:`, `   ${base}/portal`];

  const text = [
    `You've been placed on ${d.teamName}. Please complete payment as soon as possible, and no later than ${dueLabel}, to confirm your spot on the team.`,
    ``,
    `Team: ${d.teamName}`,
    `Coach: ${d.coachName}${d.coachContact ? ` (${d.coachContact})` : ""}`,
    `Location: ${d.locationName}${d.locationAddress ? ` — ${d.locationAddress}` : ""}`,
    `Practice: ${d.practiceWhen}`,
    ``,
    ...payLine,
    ...(d.waiverUrl
      ? [``, `Participation waiver — if you haven't completed yours yet, sign it here (required before the first practice):`, `   ${d.waiverUrl}`]
      : []),
    ``,
    `Questions? Contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: `Welcome to PURE Academy — you're on ${d.teamName}`,
    text,
    html: brandedEmailHtml({
      heading: `Welcome to PURE Academy!`,
      intro: `Hi ${d.name} — you've been placed on ${d.teamName}. Please complete payment as soon as possible, and no later than ${dueLabel}, to confirm your spot on the team.`,
      contentHtml,
    }),
  };
}
