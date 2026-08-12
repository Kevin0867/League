import "server-only";
import { appUrl } from "@/lib/stripe";
import { formatCents } from "@/lib/money";
import { brandedEmailHtml, emailButton } from "@/lib/email/branded";
import { sendEmail } from "@/lib/notify";

// Pure builder for a one-off payment request (custom amount, optional discount) —
// a single "Pay now" CTA to the public /pay page. No installments. Returns the
// {subject, text, html} so it can be sent directly OR routed through
// dispatchMessage (e.g. as a reminder) with consistent logging.
export function customPaymentEmailContent(opts: {
  name: string;
  amountCents: number;
  description: string;
  paymentId: string;
  discountNote?: string | null;
}): { subject: string; text: string; html: string } {
  const base = appUrl();
  const amount = formatCents(opts.amountCents);
  const payUrl = `${base}/pay/${opts.paymentId}?plan=full`;

  const contentHtml =
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">` +
    `<div style="color:#0f172a;font-weight:600">${opts.description}</div>` +
    (opts.discountNote ? `<div style="margin-top:4px;font-size:12px;color:#059669">${opts.discountNote}</div>` : "") +
    `<div style="font-size:26px;font-weight:700;color:#0f172a;margin-top:6px">${amount}</div>` +
    `</div>` +
    emailButton(payUrl, `Pay ${amount} now`, { primary: true }) +
    `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">Secure checkout is hosted by Stripe — we never see ` +
    `your card details. No account or login required.</p>`;

  const text = [
    `Hi ${opts.name},`,
    ``,
    `${opts.description}`,
    opts.discountNote ? opts.discountNote : "",
    ``,
    `Amount due: ${amount}`,
    `Pay securely here: ${payUrl}`,
    ``,
    `— PURE Academy / Arizona Club Pickleball`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    subject: `Your PURE Academy payment — ${amount}`,
    text,
    html: brandedEmailHtml({ heading: "Payment request", intro: `Hi ${opts.name},`, contentHtml }),
  };
}

// A one-off, admin-created payment request (custom amount, optional discount) —
// a single "Pay now" CTA to the public /pay page. No installments.
export async function sendCustomPaymentEmail(opts: {
  toEmail: string;
  name: string;
  amountCents: number;
  description: string;
  paymentId: string;
  discountNote?: string | null;
}) {
  const c = customPaymentEmailContent(opts);
  return sendEmail(opts.toEmail, c.subject, c.text, c.html);
}
