import "server-only";
import { appUrl } from "@/lib/stripe";
import { formatCents } from "@/lib/money";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { SUPPORT_ADDRESS } from "@/lib/payments/receipt";

// Payment request for an admin-arranged private / semi-private / group lesson.
// A single one-time charge (no installments) deep-linking to the PUBLIC /pay
// page, payable with no login. Copy is the exact wording the Academy uses.

const INTRO =
  "Thank you for signing up for a private/semi-private lesson with PURE Academy. " +
  "Your class details are below. If this doesn't look correct to you, please reply to this email, " +
  "and we will get it fixed. Please click the payment button to secure your class. " +
  "We look forward to seeing you on the court. The PURE Academy Team.";

export function lessonPaymentEmail(opts: {
  name: string;
  amountCents: number;
  paymentId: string;
  lessonTitle: string;
  coachName?: string | null;
  facilityName: string;
  when?: string | null;
}): { subject: string; text: string; html: string } {
  const base = appUrl();
  const amount = formatCents(opts.amountCents);
  const payFull = `${base}/pay/${opts.paymentId}?plan=full`;

  const detail = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px;white-space:nowrap">${label}</td>` +
    `<td style="padding:4px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td></tr>`;

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">` +
    `<table>` +
    detail("Class", opts.lessonTitle) +
    (opts.coachName ? detail("Coach", opts.coachName) : "") +
    detail("Location", opts.facilityName) +
    (opts.when ? detail("When", opts.when) : "") +
    detail("Price", amount) +
    `</table></div>` +
    emailButton(payFull, `Secure your class — pay ${amount}`, { primary: true }) +
    `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">Secure checkout is hosted by Stripe — we never see your card details. ` +
    `No account or login required.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    INTRO,
    ``,
    `Class: ${opts.lessonTitle}`,
    opts.coachName ? `Coach: ${opts.coachName}` : "",
    `Location: ${opts.facilityName}`,
    opts.when ? `When: ${opts.when}` : "",
    `Price: ${amount}`,
    ``,
    `Secure your class: ${payFull}`,
    ``,
    `Any issues, contact us at ${SUPPORT_ADDRESS}.`,
  ].filter(Boolean).join("\n");

  return {
    subject: "Secure your PURE Academy lesson",
    text,
    html: brandedEmailHtml({ heading: "Your lesson details", intro: INTRO, contentHtml }),
  };
}
