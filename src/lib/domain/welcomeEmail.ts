import "server-only";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";
import { appUrl } from "@/lib/stripe";

/**
 * A generic PURE Academy welcome — used when a player hasn't been placed on a
 * team yet, so we can still welcome them (and their family) any time. When a
 * player IS on a team, the placement/assignment email is used instead, which
 * carries team, coach, location, and practice details.
 */
export function welcomeEmail(opts: {
  recipientName: string;
  playerName: string;
}): { subject: string; text: string; html: string } {
  const portal = `${appUrl()}/portal`;
  const contentHtml =
    `<p style="margin:0 0 14px;font-size:15px;color:#475569">We&apos;re glad to have <strong>${escapeHtml(opts.playerName)}</strong> with PURE Academy for the season. Team placement is being finalized — you&apos;ll get the team, coach, location, and practice time as soon as it&apos;s set.</p>` +
    `<p style="margin:0 0 14px;font-size:14px;color:#475569">In the meantime you can view everything — placement, payment, and your waiver — from your portal.</p>` +
    `<div>${emailButton(portal, "Open your portal", { primary: true })}</div>` +
    `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Questions any time — reach us at ${SUPPORT_ADDRESS}.</p>`;

  const text = [
    `Welcome to PURE Academy!`,
    ``,
    `We're glad to have ${opts.playerName} with us for the season. Team placement is being finalized — you'll get the team, coach, location, and practice time as soon as it's set.`,
    ``,
    `View your placement, payment, and waiver from your portal: ${portal}`,
    ``,
    `Questions any time — reach us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: `Welcome to PURE Academy, ${opts.playerName}!`,
    text,
    html: brandedEmailHtml({
      heading: `Welcome to PURE Academy!`,
      intro: `Hi ${opts.recipientName} — glad to have you with us this season.`,
      contentHtml,
    }),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
