import "server-only";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";

// Branded email asking a player (or a minor's parent/guardian) to complete the
// participation waiver via a tokenized, no-login link.
export function waiverRequestEmail(opts: {
  name: string;
  link: string;
  isMinor: boolean;
}): { subject: string; text: string; html: string } {
  const who = opts.isMinor
    ? `Please complete the PURE Academy participation waiver for ${opts.name}. As their parent or guardian, you'll sign on their behalf — it only takes a minute.`
    : `Please complete your PURE Academy participation waiver — it only takes a minute.`;

  const contentHtml =
    `<p style="margin:0 0 14px;color:#475569;font-size:15px">${who}</p>` +
    emailButton(opts.link, "Complete the waiver", { primary: true }) +
    `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">No account or login required. This secure link is just for you.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    who,
    ``,
    `Complete the waiver: ${opts.link}`,
    ``,
    `Any issues, contact us at ${SUPPORT_ADDRESS}.`,
  ].join("\n");

  return {
    subject: "Please complete your PURE Academy waiver",
    text,
    html: brandedEmailHtml({ heading: "One quick step: your waiver", contentHtml }),
  };
}
